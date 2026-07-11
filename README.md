# Projects Runner

Projects Runner is a desktop app that helps you save, organize, and run the commands you use again and again across different projects.

Instead of searching through old notes, terminal history, or chat messages, you can keep your most important commands in one place and launch them whenever you need them.

## Why People Use It

- Save repeated commands for each project
- Group commands into clear sections
- Run commands from inside the app or in an external terminal
- View logs and terminal output in one place
- Keep project notes next to your commands
- Export and import projects as `.prd` files for backup or sharing

## Best For

Projects Runner is useful for:

- developers who switch between multiple local projects
- technical teams with shared setup or run commands
- solo builders who want a cleaner workflow
- anyone who repeats terminal commands and wants less manual work

## Main Features

### Project workspace

Add each local project once, then keep its folder path, description, notes, and commands together in a simple workspace.

### Saved commands

Store one-line or multi-line commands such as:

- local development servers
- build commands
- test commands
- database utilities
- deployment helpers
- maintenance scripts

### Flexible run modes

Commands can be configured to run in different ways depending on your workflow:

- internal headless runs for quick background execution
- internal interactive terminal sessions
- external terminal launches when you prefer the system terminal

### Terminal logs

See command output directly inside the app, reopen command tabs, clear logs, and rerun commands quickly.

### Notes and sharing

Keep lightweight notes inside each project and share project setups through `.prd` export/import files.

## Getting Started

### For most users

1. Open Projects Runner.
2. Add a project folder.
3. Create one or more commands for that project.
4. Choose how each command should run.
5. Run the command and monitor the output.

### Example use cases

- Start frontend and backend services for a local app
- Save onboarding commands for a new teammate
- Keep separate scripts for setup, build, and release
- Share a reusable project command set between machines

## Installation

Projects Runner is designed as a desktop app for:

- Windows
- Linux
- macOS

Release packages currently target:

- Windows: NSIS installer
- Linux: AppImage and DEB
- macOS: Apple Silicon DMG

If a packaged release is available, that is the easiest option for everyday users. You can also run the app from source if you are setting it up for development.

## Important Note About Commands

The app can run on multiple operating systems, but saved commands are still operating-system specific.

For example:

- PowerShell commands are usually Windows-specific
- `sh` or `bash` commands are usually Linux/macOS-specific
- terminal tooling can behave differently across platforms

If you share a `.prd` file with someone else, they may need to adjust commands for their operating system.

## Run From Source

### Requirements

- Node.js 20+
- npm
- Rust toolchain
- Tauri build prerequisites for your operating system

### Development

```bash
npm install
npm run tauri
```

### Production build

```bash
npm run build
npm run release:build
```

## Useful Scripts

```bash
npm run dev
npm run build
npm run preview
npm run tauri
npm run release:check
npm run release:build
npm run release:artifacts
```

## Release Process

Normal pushes to `master` do not build release artifacts.

To publish a GitHub Release, create and push a tag in the format `app-v<version>` that matches `package.json` and `src-tauri/tauri.conf.json`.

```bash
git push origin master
git tag app-v0.4.6
git push origin app-v0.4.6
```

If you ever want a pre-release validation build without publishing, run the `Manual CI Build` workflow from GitHub Actions.

## Tech Stack

- Tauri 2
- React 19
- TypeScript
- Vite
- Tailwind CSS 4

## Documentation

Additional project notes are available in [docs/cross-platform-notes.md](docs/cross-platform-notes.md) and [docs/releasing.md](docs/releasing.md).
