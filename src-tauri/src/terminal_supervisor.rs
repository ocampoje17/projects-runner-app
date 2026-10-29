use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::Utc;
use diesel::sql_query;
use diesel::RunQueryDsl;
use portable_pty::{
    native_pty_system, ChildKiller, CommandBuilder as PtyCommandBuilder, MasterPty, PtySize,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};

use crate::terminal_types::{InteractiveSessionInfo, TerminalChannelEvent};
use crate::AppPaths;

pub const SESSION_STARTING: u8 = 0;
pub const SESSION_RUNNING: u8 = 1;
pub const SESSION_STOPPING: u8 = 2;
pub const SESSION_EXITED: u8 = 3;
pub const SESSION_FAILED: u8 = 4;

const HIGH_WATERMARK_BYTES: usize = 1024 * 1024; // 1 MiB
const LOW_WATERMARK_BYTES: usize = 256 * 1024; // 256 KiB

// ConPTY's INHERIT_CURSOR handshake blocks the child until a terminal answers.
// A detached MCP session has no renderer yet. Answer its first CPR at 1;1 and
// omit that query from the replay stream so a later renderer cannot answer twice.
#[derive(Default)]
struct StartupCursorResponder {pending:Vec<u8>,answered:bool}
impl StartupCursorResponder {
    fn process(&mut self,bytes:&[u8])->(Vec<u8>,bool){
        if self.answered{return (bytes.to_vec(),false);}
        const QUERY:&[u8]=b"\x1b[6n";
        let mut output=Vec::with_capacity(bytes.len());let mut respond=false;
        for byte in bytes{
            if self.answered{output.push(*byte);continue;}
            self.pending.push(*byte);
            while !QUERY.starts_with(&self.pending){output.push(self.pending.remove(0));}
            if self.pending==QUERY{self.pending.clear();self.answered=true;respond=true;}
        }
        (output,respond)
    }
}

// Deliver every read before attempting another blocking PTY read. A shell may
// wait for a terminal response (for example CPR) before producing more output.
fn read_pty_output(
    mut reader: impl Read,
    mut before_read: impl FnMut() -> bool,
    mut on_output: impl FnMut(&[u8]),
) -> std::io::Result<()> {
    let mut buf = [0u8; 4096];
    while before_read() {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => on_output(&buf[..n]),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn terminal_output_event(
    session_id: &str,
    generation: u64,
    sequence: &AtomicU64,
    unacked_bytes: &AtomicUsize,
    bytes: &[u8],
) -> TerminalChannelEvent {
    unacked_bytes.fetch_add(bytes.len(), Ordering::SeqCst);
    TerminalChannelEvent::Output {
        session_id: session_id.to_owned(),
        generation,
        sequence: sequence.fetch_add(1, Ordering::SeqCst),
        data: BASE64_STANDARD.encode(bytes),
    }
}

fn close_pty_master(master: &Mutex<Option<Box<dyn MasterPty + Send>>>) {
    let master = master.lock().ok().and_then(|mut master| master.take());
    drop(master);
}

#[cfg(windows)]
mod win_job {
    use std::os::windows::raw::HANDLE;

    #[repr(C)]
    struct IO_COUNTERS {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        basic_limit_information: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        io_info: IO_COUNTERS,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_limit: usize,
        peak_job_memory_limit: usize,
    }

    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x00002000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: i32 = 9;

    extern "system" {
        fn CreateJobObjectW(lpJobAttributes: *mut std::ffi::c_void, lpName: *const u16) -> HANDLE;
        fn SetInformationJobObject(
            hJob: HANDLE,
            JobObjectInformationClass: i32,
            lpJobObjectInformation: *const std::ffi::c_void,
            cbJobObjectInformationLength: u32,
        ) -> i32;
        fn AssignProcessToJobObject(hJob: HANDLE, hProcess: HANDLE) -> i32;
        fn TerminateJobObject(hJob: HANDLE, uExitCode: u32) -> i32;
        fn CloseHandle(hObject: HANDLE) -> i32;
        fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> HANDLE;
    }

    pub struct WinJobHandle(pub isize);

    impl WinJobHandle {
        pub fn create_and_assign(pid: u32) -> Option<Self> {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
                if job.is_null() {
                    return None;
                }

                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                let set_res = SetInformationJobObject(
                    job,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    &info as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );

                if set_res == 0 {
                    CloseHandle(job);
                    return None;
                }

                const PROCESS_SET_QUOTA: u32 = 0x0100;
                const PROCESS_TERMINATE: u32 = 0x0001;
                let proc_handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if proc_handle.is_null() {
                    CloseHandle(job);
                    return None;
                }

                let assign_res = AssignProcessToJobObject(job, proc_handle);
                CloseHandle(proc_handle);

                if assign_res == 0 {
                    CloseHandle(job);
                    return None;
                }

                Some(WinJobHandle(job as isize))
            }
        }

        pub fn terminate(&self, exit_code: u32) {
            unsafe {
                if self.0 != 0 {
                    TerminateJobObject(self.0 as HANDLE, exit_code);
                }
            }
        }
    }

    impl Drop for WinJobHandle {
        fn drop(&mut self) {
            unsafe {
                if self.0 != 0 {
                    CloseHandle(self.0 as HANDLE);
                }
            }
        }
    }
}

#[derive(Clone)]
pub struct TerminalSink { channel: Option<Channel<TerminalChannelEvent>>, detached: Option<(AppHandle,i64)> }
impl TerminalSink {
    pub fn channel(channel: Channel<TerminalChannelEvent>) -> Self { Self {channel:Some(channel),detached:None} }
    pub fn detached(app:AppHandle,command:i64)->Self {Self{channel:None,detached:Some((app,command))}}
    fn is_detached(&self)->bool {self.detached.is_some()}
    fn send(&self,event:TerminalChannelEvent)->Result<(),String>{
        if let Some(channel)=&self.channel{return channel.send(event).map_err(|e|e.to_string());}
        if let Some((app,cid))=&self.detached {
            let _=app.emit("mcp://terminal-event", &event);
            if matches!(&event,TerminalChannelEvent::Output{..}) {return Ok(());}

            let payload=match &event {
                TerminalChannelEvent::Started{session_id,run_id,cols,rows,started_at,..}=>serde_json::json!({"session_id":session_id,"run_id":run_id,"command_id":cid,"cols":cols,"rows":rows,"started_at":started_at}),
                TerminalChannelEvent::Output{session_id,data,..}=>serde_json::json!({"session_id":session_id,"command_id":cid,"data":String::from_utf8_lossy(&BASE64_STANDARD.decode(data).unwrap_or_default())}),
                TerminalChannelEvent::Exited{session_id,run_id,status,exit_code,ended_at,..}=>serde_json::json!({"session_id":session_id,"run_id":run_id,"command_id":cid,"status":status,"exit_code":exit_code,"ended_at":ended_at}),
                TerminalChannelEvent::Error{session_id,error,..}=>serde_json::json!({"session_id":session_id,"command_id":cid,"error":error}),
            };
            let name=match event {TerminalChannelEvent::Started{..}=>"pty://started",TerminalChannelEvent::Output{..}=>"pty://data",TerminalChannelEvent::Exited{..}=>"pty://exit",TerminalChannelEvent::Error{..}=>"pty://error"};
            app.emit(name,payload).map_err(|e|e.to_string())?;
        }Ok(())
    }
}

pub struct ActiveSession {
    pub session_id: String,
    pub run_id: i64,
    pub command_id: i64,
    pub generation: u64,
    pub info: InteractiveSessionInfo,
    pub detached: bool,
    pub raw_output: Mutex<std::collections::VecDeque<u8>>,
    pub status: AtomicU8,
    pub script_path: PathBuf,
    pub pty_master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    pub pty_writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub child_killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    pub unacked_bytes: Arc<AtomicUsize>,
    pub flow_control: Arc<(Mutex<bool>, Condvar)>,
    pub sequence: AtomicU64,
    pub highest_acked_seq: AtomicU64,
    #[cfg(windows)]
    pub job_handle: Option<Arc<win_job::WinJobHandle>>,
}

pub struct TerminalSupervisor {
    pub command_operations: Mutex<()>,
    sessions: Arc<Mutex<HashMap<String, Arc<ActiveSession>>>>,
    sessions_by_command: Arc<Mutex<HashMap<i64, String>>>,
    sessions_by_terminal: Arc<Mutex<HashMap<i64, String>>>,
    reserving_commands: Arc<Mutex<HashMap<i64, Instant>>>,
    generation_counter: AtomicU64,
}

impl TerminalSupervisor {
    pub fn new() -> Self {
        Self {
            command_operations: Mutex::new(()),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            sessions_by_command: Arc::new(Mutex::new(HashMap::new())),
            sessions_by_terminal: Arc::new(Mutex::new(HashMap::new())),
            reserving_commands: Arc::new(Mutex::new(HashMap::new())),
            generation_counter: AtomicU64::new(1),
        }
    }

    pub fn reserve_command(&self, command_id: i64) -> Result<(), String> {
        let mut reserving = self.reserving_commands.lock().map_err(|e| e.to_string())?;
        let now = Instant::now();
        reserving.retain(|_, time| now.duration_since(*time) < Duration::from_secs(5));

        if reserving.contains_key(&command_id) {
            return Err("This command is currently starting...".to_string());
        }

        let sessions = self.sessions_by_command.lock().map_err(|e| e.to_string())?;
        if sessions.contains_key(&command_id) {
            return Err("This command is already running".to_string());
        }

        reserving.insert(command_id, now);
        Ok(())
    }

    pub fn unreserve_command(&self, command_id: i64) {
        if let Ok(mut reserving) = self.reserving_commands.lock() {
            reserving.remove(&command_id);
        }
    }

    pub fn get_session(&self, session_id: &str) -> Option<Arc<ActiveSession>> {
        self.sessions.lock().ok()?.get(session_id).cloned()
    }

    pub fn get_session_by_command(&self, command_id: i64) -> Option<Arc<ActiveSession>> {
        let sid = self.sessions_by_command.lock().ok()?.get(&command_id).cloned()?;
        self.get_session(&sid)
    }

    pub fn get_active_command_ids(&self) -> Vec<i64> {
        let mut active = Vec::new();
        if let Ok(reserving) = self.reserving_commands.lock() {
            for &cid in reserving.keys() {
                active.push(cid);
            }
        }
        if let Ok(sessions) = self.sessions_by_command.lock() {
            for (&cid, sid) in sessions.iter() {
                if let Some(session) = self.get_session(sid) {
                    if session.status.load(Ordering::SeqCst) < SESSION_EXITED {
                        if !active.contains(&cid) {
                            active.push(cid);
                        }
                    }
                }
            }
        }
        active
    }

    pub fn detached_snapshots(&self)->Vec<serde_json::Value>{
        let Ok(sessions)=self.sessions.lock() else{return vec![]};
        sessions.values().filter(|s|s.detached&&s.status.load(Ordering::SeqCst)<=SESSION_STOPPING).map(|s|{
            let raw=s.raw_output.lock().unwrap();let output=raw.iter().copied().collect::<Vec<_>>();
            serde_json::json!({"info":s.info,"generation":s.generation,"sequence":s.sequence.load(Ordering::SeqCst).saturating_sub(1),"data":BASE64_STANDARD.encode(output)})
        }).collect()
    }

    pub fn wake_flow_control(&self, session: &ActiveSession) {
        let (lock, cvar) = &*session.flow_control;
        if let Ok(mut paused) = lock.lock() {
            *paused = false;
            cvar.notify_all();
        }
    }

    pub fn ack_output(&self, session_id: &str, generation: u64, sequence: u64, bytes_processed: usize) {
        if let Some(session) = self.get_session(session_id) {
            if session.generation != generation {
                return;
            }

            let mut prev_acked = session.highest_acked_seq.load(Ordering::SeqCst);
            while sequence > prev_acked {
                match session.highest_acked_seq.compare_exchange_weak(
                    prev_acked,
                    sequence,
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                ) {
                    Ok(_) => {
                        let current = session.unacked_bytes.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |val| {
                            Some(val.saturating_sub(bytes_processed))
                        }).unwrap_or(0);

                        let new_val = current.saturating_sub(bytes_processed);
                        if new_val < LOW_WATERMARK_BYTES {
                            let (lock, cvar) = &*session.flow_control;
                            if let Ok(mut paused) = lock.lock() {
                                if *paused {
                                    *paused = false;
                                    cvar.notify_all();
                                }
                            }
                        }
                        break;
                    }
                    Err(actual) => prev_acked = actual,
                }
            }
        }
    }

    pub fn write_input(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let session = self.get_session(session_id).ok_or("Terminal session not found")?;
        let status = session.status.load(Ordering::SeqCst);
        if status != SESSION_RUNNING && status != SESSION_STARTING && status != SESSION_STOPPING {
            return Err("Terminal session is not running".to_string());
        }

        let mut writer = session.pty_writer.lock().map_err(|e| e.to_string())?;
        writer.write_all(data).map_err(|e| format!("Failed to write to terminal: {}", e))?;
        writer.flush().map_err(|e| format!("Failed to flush terminal input: {}", e))?;
        Ok(())
    }

    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if cols == 0 || rows == 0 {
            return Ok(());
        }
        let session = self.get_session(session_id).ok_or("Terminal session not found")?;
        let master = session.pty_master.lock().map_err(|e| e.to_string())?;
        let master = master.as_ref().ok_or("Terminal session is closing")?;
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| format!("Failed to resize PTY: {}", e))
    }

    pub fn interrupt_session(&self, session_id: &str) -> Result<(), String> {
        self.write_input(session_id, b"\x03")
    }

    pub fn stop_session(&self, session_id: &str, _app: AppHandle) -> Result<(), String> {
        let session = self.get_session(session_id).ok_or("Terminal session not found")?;
        let prev = session.status.swap(SESSION_STOPPING, Ordering::SeqCst);
        if prev != SESSION_RUNNING && prev != SESSION_STARTING {
            return Ok(());
        }

        self.wake_flow_control(&session);

        // 1. Send SIGINT (Ctrl+C) first
        let _ = self.write_input(session_id, b"\x03");

        // 2. Schedule kill after 2s if still running
        let session_clone = session.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(2000)).await;
            if session_clone.status.load(Ordering::SeqCst) == SESSION_STOPPING {
                #[cfg(windows)]
                if let Some(ref job) = session_clone.job_handle {
                    job.terminate(1);
                }
                if let Ok(mut killer) = session_clone.child_killer.lock() {
                    let _ = killer.kill();
                }
            }
        });

        Ok(())
    }

    pub fn force_stop_session(&self, session_id: &str) -> Result<(), String> {
        let session = self.get_session(session_id).ok_or("Terminal session not found")?;
        session.status.store(SESSION_STOPPING, Ordering::SeqCst);
        self.wake_flow_control(&session);

        #[cfg(windows)]
        if let Some(ref job) = session.job_handle {
            job.terminate(1);
        }

        if let Ok(mut killer) = session.child_killer.lock() {
            let _ = killer.kill();
        }

        Ok(())
    }

    pub fn terminate_all(&self) {
        if let Ok(sessions) = self.sessions.lock() {
            for session in sessions.values() {
                session.status.store(SESSION_STOPPING, Ordering::SeqCst);
                self.wake_flow_control(session);
                #[cfg(windows)]
                if let Some(ref job) = session.job_handle {
                    job.terminate(1);
                }
                if let Ok(mut killer) = session.child_killer.lock() {
                    let _ = killer.kill();
                }
                let _ = fs::remove_file(&session.script_path);
            }
        }
    }

    pub fn spawn_and_supervise(
        &self,
        command_id: i64,
        terminal_id: Option<i64>,
        run_id: i64,
        cols: u16,
        rows: u16,
        script_path: PathBuf,
        pty_command: PtyCommandBuilder,
        on_event: TerminalSink,
        paths: AppPaths,
        output_app: AppHandle,
    ) -> Result<InteractiveSessionInfo, String> {
        let generation = self.generation_counter.fetch_add(1, Ordering::SeqCst);
        let session_id = uuid::Uuid::new_v4().to_string();

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: rows.max(1),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| {
                self.unreserve_command(command_id);
                e.to_string()
            })?;

        let mut child = match pair.slave.spawn_command(pty_command) {
            Ok(c) => c,
            Err(e) => {
                self.unreserve_command(command_id);
                let _ = fs::remove_file(&script_path);
                return Err(e.to_string());
            }
        };

        // The master owns the console after spawning; do not retain the slave handle.
        drop(pair.slave);

        let pid = child.process_id();
        #[cfg(windows)]
        let job_handle = pid.and_then(|p| win_job::WinJobHandle::create_and_assign(p).map(Arc::new));

        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let killer = child.clone_killer();

        let session = Arc::new(ActiveSession {
            session_id: session_id.clone(),
            run_id,
            command_id,
            generation,
            info: InteractiveSessionInfo{session_id:session_id.clone(),run_id,command_id,cols:cols.max(2),rows:rows.max(1),started_at:Utc::now().to_rfc3339()},
            detached: on_event.is_detached(),
            raw_output: Mutex::new(Default::default()),
            status: AtomicU8::new(SESSION_RUNNING),
            script_path: script_path.clone(),
            pty_master: Arc::new(Mutex::new(Some(pair.master))),
            pty_writer: Arc::new(Mutex::new(writer)),
            child_killer: Arc::new(Mutex::new(killer)),
            unacked_bytes: Arc::new(AtomicUsize::new(0)),
            flow_control: Arc::new((Mutex::new(false), Condvar::new())),
            sequence: AtomicU64::new(1),
            highest_acked_seq: AtomicU64::new(0),
            #[cfg(windows)]
            job_handle,
        });

        // Register session
        if let Ok(mut map) = self.sessions.lock() {
            map.insert(session_id.clone(), session.clone());
        }
        if let Ok(mut cmd_map) = self.sessions_by_command.lock() {
            cmd_map.insert(command_id, session_id.clone());
        }
        if let Some(tid) = terminal_id {
            if let Ok(mut term_map) = self.sessions_by_terminal.lock() {
                term_map.insert(tid, session_id.clone());
            }
        }
        self.unreserve_command(command_id);

        let started_at = Utc::now().to_rfc3339();
        let session_info = InteractiveSessionInfo {
            session_id: session_id.clone(),
            run_id,
            command_id,
            cols: cols.max(2),
            rows: rows.max(1),
            started_at: started_at.clone(),
        };

        crate::mcp::output::start(&output_app,run_id,true);
        // Emit channel Started event
        let _ = on_event.send(TerminalChannelEvent::Started {
            session_id: session_id.clone(),
            run_id,
            command_id,
            generation,
            sequence: 0,
            cols: cols.max(2),
            rows: rows.max(1),
            started_at,
        });

        // 1. Spawn PTY reader thread
        let session_for_reader = session.clone();
        let on_event_for_reader = on_event.clone();
        let app_for_output = output_app.clone();
        let reader_thread = std::thread::spawn(move || {
            let mut startup_cursor=StartupCursorResponder::default();
            let result = read_pty_output(
                reader,
                || {
                    // Flow control wait if above high watermark
                    if session_for_reader.unacked_bytes.load(Ordering::SeqCst) >= HIGH_WATERMARK_BYTES {
                        let (lock, cvar) = &*session_for_reader.flow_control;
                        if let Ok(mut paused) = lock.lock() {
                            *paused = true;
                            while *paused
                                && session_for_reader.status.load(Ordering::SeqCst) <= SESSION_STOPPING
                            {
                                let (new_guard, timeout_res) = cvar
                                    .wait_timeout(paused, Duration::from_millis(100))
                                    .unwrap();
                                paused = new_guard;
                                if timeout_res.timed_out()
                                    && session_for_reader.unacked_bytes.load(Ordering::SeqCst)
                                        < LOW_WATERMARK_BYTES
                                {
                                    *paused = false;
                                    break;
                                }
                            }
                        }
                    }

                    session_for_reader.status.load(Ordering::SeqCst) <= SESSION_STOPPING
                },
                |bytes| {
                    let processed;
                    let bytes=if cfg!(windows)&&on_event_for_reader.is_detached(){
                        let (output,respond)=startup_cursor.process(bytes);
                        if respond{if let Ok(mut writer)=session_for_reader.pty_writer.lock(){let _=writer.write_all(b"\x1b[1;1R");let _=writer.flush();}}
                        processed=output;processed.as_slice()
                    }else{bytes};
                    if bytes.is_empty(){return;}
                    let mut raw=session_for_reader.raw_output.lock().unwrap();raw.extend(bytes);let discard=raw.len().saturating_sub(1024*1024);raw.drain(..discard);
                    crate::mcp::output::push(&app_for_output, run_id, bytes);
                    let event = terminal_output_event(
                        &session_for_reader.session_id,
                        session_for_reader.generation,
                        &session_for_reader.sequence,
                        &session_for_reader.unacked_bytes,
                        bytes,
                    );
                    let _ = on_event_for_reader.send(event);
                    if on_event_for_reader.is_detached() { session_for_reader.unacked_bytes.store(0, Ordering::SeqCst); }
                },
            );
            if let Err(error) = result {
                let _ = on_event_for_reader.send(TerminalChannelEvent::Error {
                    session_id: session_for_reader.session_id.clone(),
                    generation: session_for_reader.generation,
                    sequence: session_for_reader.sequence.fetch_add(1, Ordering::SeqCst),
                    error: error.to_string(),
                });
            }
        });

        // 2. Spawn waiter thread coordinated with reader
        let session_for_wait = session.clone();
        let sessions_map = self.sessions.clone();
        let cmd_map = self.sessions_by_command.clone();
        let term_map = self.sessions_by_terminal.clone();

        std::thread::spawn(move || {
            let wait_res = child.wait();
            let exit_code = wait_res.ok().map(|st| st.exit_code() as i32);

            // ConPTY keeps its output pipe open until the console is closed.
            // Close the master while the reader is still draining; joining first
            // waits forever for EOF even though the child has already exited.
            close_pty_master(&session_for_wait.pty_master);

            // Wait for reader thread to finish all PTY draining.
            let _ = reader_thread.join();

            let was_stopping = session_for_wait.status.load(Ordering::SeqCst) == SESSION_STOPPING;
            let final_status = if was_stopping {
                "stopped"
            } else if exit_code == Some(0) {
                "exited"
            } else {
                "failed"
            };

            session_for_wait.status.store(
                if final_status == "failed" { SESSION_FAILED } else { SESSION_EXITED },
                Ordering::SeqCst,
            );

            let ended_at = Utc::now().to_rfc3339();

            // Update database command_runs
            if let Ok(mut conn) = crate::connect(&paths) {
                let _ = sql_query(format!(
                    "UPDATE command_runs SET status = '{}', ended_at = '{}', exit_code = {} WHERE id = {}",
                    final_status,
                    ended_at,
                    exit_code.map(|c| c.to_string()).unwrap_or_else(|| "NULL".to_string()),
                    run_id
                ))
                .execute(&mut conn);
            }

            // Cleanup registries
            if let Ok(mut map) = sessions_map.lock() {
                map.remove(&session_for_wait.session_id);
            }
            if let Ok(mut cmap) = cmd_map.lock() {
                cmap.remove(&command_id);
            }
            if let Some(tid) = terminal_id {
                if let Ok(mut tmap) = term_map.lock() {
                    tmap.remove(&tid);
                }
            }
            let _ = fs::remove_file(&session_for_wait.script_path);

            crate::mcp::output::finish(&output_app, run_id);
            // Send Channel Exited event
            let _ = on_event.send(TerminalChannelEvent::Exited {
                session_id: session_for_wait.session_id.clone(),
                run_id,
                command_id,
                generation,
                sequence: session_for_wait.sequence.fetch_add(1, Ordering::SeqCst),
                exit_code,
                status: final_status.to_string(),
                ended_at,
            });
        });

        Ok(session_info)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::mpsc::{self, Receiver};
    #[test]
    fn detached_startup_answers_split_cpr_once_without_replaying_query(){
        let mut responder=StartupCursorResponder::default();let mut output=vec![];let mut answers=0;
        for byte in b"\x1b[6n\x1b[32mhello\x1b[0m\x1b[6n"{
            let (bytes,answer)=responder.process(&[*byte]);output.extend(bytes);answers+=usize::from(answer);
        }
        assert_eq!(answers,1);assert_eq!(output,b"\x1b[32mhello\x1b[0m\x1b[6n");
    }

    // Each read after the first waits for the preceding output to be delivered.
    // This models a shell waiting for CPR/input, without a permanently stuck test.
    struct GatedReader {
        chunks: VecDeque<Vec<u8>>,
        delivered: Receiver<()>,
        has_read: bool,
    }

    impl Read for GatedReader {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.has_read {
                self.delivered
                    .recv_timeout(Duration::from_secs(2))
                    .map_err(|_| {
                        std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            "PTY output was held while attempting the next blocking read",
                        )
                    })?;
            }
            self.has_read = true;
            let Some(chunk) = self.chunks.pop_front() else {
                return Ok(0);
            };
            buf[..chunk.len()].copy_from_slice(&chunk);
            Ok(chunk.len())
        }
    }

    #[test]
    fn small_cursor_query_is_delivered_before_next_read_or_eof() {
        let (tx, rx) = mpsc::channel();
        let reader = GatedReader {
            chunks: VecDeque::from([b"\x1b[6n".to_vec()]),
            delivered: rx,
            has_read: false,
        };
        let mut output = Vec::new();
        read_pty_output(
            reader,
            || true,
            |bytes| {
                output.extend_from_slice(bytes);
                tx.send(()).unwrap();
            },
        )
        .unwrap();
        assert_eq!(output, b"\x1b[6n");
    }

    #[test]
    fn output_preserves_split_utf8_ansi_sequence_and_unacked_byte_count() {
        let expected = "\x1b[32mTiếng Việt\x1b[0m".as_bytes();
        // One byte per read deliberately splits UTF-8 and escape sequences.
        let chunks = expected.iter().map(|byte| vec![*byte]).collect();
        let (tx, rx) = mpsc::channel();
        let reader = GatedReader {
            chunks,
            delivered: rx,
            has_read: false,
        };
        let sequence = AtomicU64::new(1);
        let unacked = AtomicUsize::new(0);
        let mut output = Vec::new();
        let mut next_sequence = 1;
        read_pty_output(
            reader,
            || true,
            |bytes| {
                let event = terminal_output_event("test-session", 42, &sequence, &unacked, bytes);
                let TerminalChannelEvent::Output {
                    session_id,
                    generation,
                    sequence,
                    data,
                } = event
                else {
                    panic!("expected an output event");
                };
                assert_eq!(session_id, "test-session");
                assert_eq!(generation, 42);
                assert_eq!(sequence, next_sequence);
                next_sequence += 1;
                output.extend(BASE64_STANDARD.decode(data).unwrap());
                assert_eq!(unacked.load(Ordering::SeqCst), output.len());
                tx.send(()).unwrap();
            },
        )
        .unwrap();
        assert_eq!(output, expected);
        assert_eq!(unacked.load(Ordering::SeqCst), expected.len());
        assert_eq!(sequence.load(Ordering::SeqCst), next_sequence);
    }

    #[cfg(windows)]
    #[test]
    fn exited_child_closes_console_and_drains_tail_output() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = PtyCommandBuilder::new("cmd.exe");
        command.args(["/D", "/Q", "/C", "echo qa-pty-drained"]);
        let mut child = pair.slave.spawn_command(command).unwrap();
        let mut killer = child.clone_killer();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let master = Mutex::new(Some(pair.master));
        let (tx, rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let drain = std::thread::spawn(move || {
                let mut output = Vec::new();
                let result = read_pty_output(
                    reader,
                    || true,
                    |bytes| {
                        output.extend_from_slice(bytes);
                        // ConPTY can request the terminal cursor during startup.
                        if output.ends_with(b"\x1b[6n") {
                            writer.write_all(b"\x1b[1;1R").unwrap();
                            writer.flush().unwrap();
                        }
                    },
                );
                (result, output)
            });
            let status = child.wait().unwrap();
            close_pty_master(&master);
            tx.send((status.exit_code(), drain.join().unwrap()))
                .unwrap();
        });
        let result = rx.recv_timeout(Duration::from_secs(10));
        if result.is_err() {
            let _ = killer.kill();
        }
        let (exit_code, (read_result, output)) =
            result.expect("console did not deliver EOF after child exit");
        worker.join().unwrap();
        read_result.unwrap();
        assert_eq!(exit_code, 0);
        assert!(String::from_utf8_lossy(&output).contains("qa-pty-drained"));
    }

    #[test]
    fn stopped_reader_does_not_read_or_emit() {
        struct UnexpectedRead;
        impl Read for UnexpectedRead {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                panic!("must check session status before reading");
            }
        }
        read_pty_output(UnexpectedRead, || false, |_| panic!("unexpected output")).unwrap();
    }

    #[test]
    fn interrupted_reads_retry_and_errors_preserve_preceding_output() {
        struct FallibleReader(usize);
        impl Read for FallibleReader {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                self.0 += 1;
                match self.0 {
                    1 => Err(std::io::ErrorKind::Interrupted.into()),
                    2 => {
                        buf[0] = b'x';
                        Ok(1)
                    }
                    _ => Err(std::io::ErrorKind::BrokenPipe.into()),
                }
            }
        }
        let mut output = Vec::new();
        let error = read_pty_output(
            FallibleReader(0),
            || true,
            |bytes| {
                output.extend_from_slice(bytes);
            },
        )
        .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::BrokenPipe);
        assert_eq!(output, b"x");
    }
}
