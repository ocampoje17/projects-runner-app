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
use tauri::AppHandle;

use crate::terminal_types::{InteractiveSessionInfo, TerminalChannelEvent};
use crate::AppPaths;

pub const SESSION_STARTING: u8 = 0;
pub const SESSION_RUNNING: u8 = 1;
pub const SESSION_STOPPING: u8 = 2;
pub const SESSION_EXITED: u8 = 3;
pub const SESSION_FAILED: u8 = 4;

const MAX_CHUNK_BYTES: usize = 32 * 1024; // 32 KiB
const MAX_DEBOUNCE_MS: u64 = 8;
const HIGH_WATERMARK_BYTES: usize = 1024 * 1024; // 1 MiB
const LOW_WATERMARK_BYTES: usize = 256 * 1024; // 256 KiB

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

pub struct ActiveSession {
    pub session_id: String,
    pub run_id: i64,
    pub command_id: i64,
    pub generation: u64,
    pub status: AtomicU8,
    pub script_path: PathBuf,
    pub pty_master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
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
    sessions: Arc<Mutex<HashMap<String, Arc<ActiveSession>>>>,
    sessions_by_command: Arc<Mutex<HashMap<i64, String>>>,
    sessions_by_terminal: Arc<Mutex<HashMap<i64, String>>>,
    reserving_commands: Arc<Mutex<HashMap<i64, Instant>>>,
    generation_counter: AtomicU64,
}

impl TerminalSupervisor {
    pub fn new() -> Self {
        Self {
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
        on_event: Channel<TerminalChannelEvent>,
        paths: AppPaths,
        _app: AppHandle,
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
            status: AtomicU8::new(SESSION_RUNNING),
            script_path: script_path.clone(),
            pty_master: Arc::new(Mutex::new(pair.master)),
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
        let reader_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut accumulator = Vec::with_capacity(MAX_CHUNK_BYTES);
            let mut last_flush = Instant::now();
            let mut r = reader;

            loop {
                // Flow control wait if above high watermark
                if session_for_reader.unacked_bytes.load(Ordering::SeqCst) >= HIGH_WATERMARK_BYTES {
                    let (lock, cvar) = &*session_for_reader.flow_control;
                    if let Ok(mut paused) = lock.lock() {
                        *paused = true;
                        while *paused && session_for_reader.status.load(Ordering::SeqCst) <= SESSION_STOPPING {
                            let (new_guard, timeout_res) = cvar.wait_timeout(paused, Duration::from_millis(100)).unwrap();
                            paused = new_guard;
                            if timeout_res.timed_out() && session_for_reader.unacked_bytes.load(Ordering::SeqCst) < LOW_WATERMARK_BYTES {
                                *paused = false;
                                break;
                            }
                        }
                    }
                }

                if session_for_reader.status.load(Ordering::SeqCst) > SESSION_STOPPING {
                    break;
                }

                match r.read(&mut buf) {
                    Ok(0) => {
                        // EOF
                        if !accumulator.is_empty() {
                            let seq = session_for_reader.sequence.fetch_add(1, Ordering::SeqCst);
                            let encoded = BASE64_STANDARD.encode(&accumulator);
                            let _ = on_event_for_reader.send(TerminalChannelEvent::Output {
                                session_id: session_for_reader.session_id.clone(),
                                generation: session_for_reader.generation,
                                sequence: seq,
                                data: encoded,
                            });
                            accumulator.clear();
                        }
                        break;
                    }
                    Ok(n) => {
                        accumulator.extend_from_slice(&buf[..n]);
                        let elapsed = last_flush.elapsed().as_millis() as u64;

                        if accumulator.len() >= MAX_CHUNK_BYTES || elapsed >= MAX_DEBOUNCE_MS {
                            let chunk_len = accumulator.len();
                            session_for_reader.unacked_bytes.fetch_add(chunk_len, Ordering::SeqCst);
                            let seq = session_for_reader.sequence.fetch_add(1, Ordering::SeqCst);
                            let encoded = BASE64_STANDARD.encode(&accumulator);

                            let _ = on_event_for_reader.send(TerminalChannelEvent::Output {
                                session_id: session_for_reader.session_id.clone(),
                                generation: session_for_reader.generation,
                                sequence: seq,
                                data: encoded,
                            });

                            accumulator.clear();
                            last_flush = Instant::now();
                        }
                    }
                    Err(e) => {
                        let _ = on_event_for_reader.send(TerminalChannelEvent::Error {
                            session_id: session_for_reader.session_id.clone(),
                            generation: session_for_reader.generation,
                            sequence: session_for_reader.sequence.fetch_add(1, Ordering::SeqCst),
                            error: e.to_string(),
                        });
                        break;
                    }
                }
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

            // Wait for reader thread to finish all PTY draining
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
