use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DevProjectType {
    pub id: String,
    pub label: String,
    pub category: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DevProjectTypeScan {
    pub detected_type_ids: Vec<String>,
    pub evidence: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DevCacheCandidate {
    pub id: String,
    pub relative_path: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub project_type_ids: Vec<String>,
    pub is_dependency: bool,
}

#[derive(Clone, Copy)]
struct ProjectTypeDefinition {
    id: &'static str,
    label: &'static str,
    category: &'static str,
    description: &'static str,
    markers: &'static [&'static str],
    content_markers: &'static [(&'static str, &'static str)],
    cache_patterns: &'static [&'static str],
    dependency_patterns: &'static [&'static str],
}

macro_rules! project_type {
    ($id:literal, $label:literal, $category:literal, $description:literal, [$($marker:literal),*], [$($file:literal => $needle:literal),*], [$($cache:literal),*], [$($dep:literal),*]) => {
        ProjectTypeDefinition {
            id: $id, label: $label, category: $category, description: $description,
            markers: &[$($marker),*], content_markers: &[$(($file, $needle)),*],
            cache_patterns: &[$($cache),*], dependency_patterns: &[$($dep),*],
        }
    };
    ($id:literal, $label:literal, $category:literal, $description:literal, [$($marker:literal),*], [$($file:literal => $needle:literal),*], [$($cache:literal),*]) => {
        ProjectTypeDefinition {
            id: $id, label: $label, category: $category, description: $description,
            markers: &[$($marker),*], content_markers: &[$(($file, $needle)),*],
            cache_patterns: &[$($cache),*], dependency_patterns: &[],
        }
    };
}

// Markers are deliberately deterministic and local. Content checks are
// case-insensitive and limited to small manifest files.
static PROJECT_TYPES: &[ProjectTypeDefinition] = &[
    project_type!(
        "node",
        "Node.js",
        "JavaScript & Web",
        "Node.js project",
        ["package.json"],
        [],
        ["dist", "build", "out", "coverage", ".cache"],
        ["node_modules"]
    ),
    project_type!(
        "bun",
        "Bun",
        "JavaScript & Web",
        "Bun runtime project",
        ["bun.lock", "bun.lockb"],
        [],
        ["dist", "build", ".cache"],
        ["node_modules"]
    ),
    project_type!(
        "deno",
        "Deno",
        "JavaScript & Web",
        "Deno runtime project",
        ["deno.json", "deno.jsonc", "deno.lock"],
        [],
        ["dist", "coverage"],
        ["node_modules", ".deno"]
    ),
    project_type!("vite", "Vite", "JavaScript & Web", "Vite-powered application", [], ["package.json" => "vite"], ["dist", ".vite"], ["node_modules"]),
    project_type!("webpack", "Webpack", "JavaScript & Web", "Webpack application", ["webpack.config.js", "webpack.config.ts", "webpack.config.cjs", "webpack.config.mjs"], ["package.json" => "webpack"], ["dist", "build", ".cache"], ["node_modules"]),
    project_type!("parcel", "Parcel", "JavaScript & Web", "Parcel application", [], ["package.json" => "parcel"], ["dist", ".parcel-cache"], ["node_modules"]),
    project_type!("react", "React", "JavaScript & Web", "React application", [], ["package.json" => "react"], ["dist", "build", "coverage"], ["node_modules"]),
    project_type!("nextjs", "Next.js", "JavaScript & Web", "Next.js application", ["next.config.js", "next.config.ts", "next.config.mjs"], ["package.json" => "next"], [".next", "out", "coverage"], ["node_modules"]),
    project_type!("remix", "Remix / React Router", "JavaScript & Web", "Remix or React Router framework project", ["remix.config.js"], ["package.json" => "@remix-run", "package.json" => "react-router"], ["build", ".react-router"], ["node_modules"]),
    project_type!("gatsby", "Gatsby", "JavaScript & Web", "Gatsby site", ["gatsby-config.js", "gatsby-config.ts"], ["package.json" => "gatsby"], ["public", ".cache"], ["node_modules"]),
    project_type!("vue", "Vue", "JavaScript & Web", "Vue application", [], ["package.json" => "vue"], ["dist", "coverage"], ["node_modules"]),
    project_type!("nuxt", "Nuxt", "JavaScript & Web", "Nuxt application", ["nuxt.config.ts", "nuxt.config.js"], ["package.json" => "nuxt"], [".nuxt", ".output", "dist"], ["node_modules"]),
    project_type!("angular", "Angular", "JavaScript & Web", "Angular application", ["angular.json"], ["package.json" => "@angular/core"], ["dist", ".angular/cache", "coverage"], ["node_modules"]),
    project_type!("svelte", "Svelte", "JavaScript & Web", "Svelte application", ["svelte.config.js", "svelte.config.ts"], ["package.json" => "svelte"], ["dist", "build", ".svelte-kit"], ["node_modules"]),
    project_type!("sveltekit", "SvelteKit", "JavaScript & Web", "SvelteKit application", ["svelte.config.js", "svelte.config.ts"], ["package.json" => "@sveltejs/kit"], [".svelte-kit", "build"], ["node_modules"]),
    project_type!("astro", "Astro", "JavaScript & Web", "Astro site", ["astro.config.mjs", "astro.config.ts", "astro.config.js"], ["package.json" => "astro"], ["dist", ".astro"], ["node_modules"]),
    project_type!("solidstart", "SolidStart", "JavaScript & Web", "SolidStart application", [], ["package.json" => "@solidjs/start"], [".output", "dist"], ["node_modules"]),
    project_type!("qwik", "Qwik", "JavaScript & Web", "Qwik application", [], ["package.json" => "@builder.io/qwik"], ["dist", "server"], ["node_modules"]),
    project_type!("ember", "Ember", "JavaScript & Web", "Ember application", ["ember-cli-build.js"], ["package.json" => "ember-cli"], ["dist", "tmp"], ["node_modules"]),
    project_type!("nestjs", "NestJS", "JavaScript & Web", "NestJS service", ["nest-cli.json"], ["package.json" => "@nestjs/core"], ["dist", "coverage"], ["node_modules"]),
    project_type!("express", "Express", "JavaScript & Web", "Express service", [], ["package.json" => "express"], ["dist", "build", "coverage"], ["node_modules"]),
    project_type!("fastify", "Fastify", "JavaScript & Web", "Fastify service", [], ["package.json" => "fastify"], ["dist", "build", "coverage"], ["node_modules"]),
    project_type!("adonisjs", "AdonisJS", "JavaScript & Web", "AdonisJS service", ["adonisrc.ts", ".adonisrc.json"], ["package.json" => "@adonisjs/core"], ["build", "tmp"], ["node_modules"]),
    project_type!("turborepo", "Turborepo", "Workspace, Desktop & Mobile", "Turborepo workspace", ["turbo.json"], ["package.json" => "turbo"], [".turbo"], ["node_modules"]),
    project_type!("nx", "Nx", "Workspace, Desktop & Mobile", "Nx workspace", ["nx.json"], ["package.json" => "nx"], [".nx/cache", "dist"], ["node_modules"]),
    project_type!(
        "lerna",
        "Lerna",
        "Workspace, Desktop & Mobile",
        "Lerna workspace",
        ["lerna.json"],
        [],
        ["dist"],
        ["node_modules"]
    ),
    project_type!("js-workspace", "pnpm / Yarn Workspace", "Workspace, Desktop & Mobile", "JavaScript monorepo workspace", ["pnpm-workspace.yaml"], ["package.json" => "workspaces"], ["dist", "build", ".cache"], ["node_modules", ".pnpm-store"]),
    project_type!("tauri", "Tauri", "Workspace, Desktop & Mobile", "Tauri desktop application", ["src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"], ["package.json" => "@tauri-apps"], ["src-tauri/target", "dist"], ["node_modules"]),
    project_type!("electron", "Electron", "Workspace, Desktop & Mobile", "Electron desktop application", [], ["package.json" => "electron"], ["dist", "build", "out", ".webpack"], ["node_modules"]),
    project_type!(
        "wails",
        "Wails",
        "Workspace, Desktop & Mobile",
        "Wails desktop application",
        ["wails.json"],
        [],
        ["build", "frontend/dist"],
        ["frontend/node_modules"]
    ),
    project_type!("react-native", "React Native", "Workspace, Desktop & Mobile", "React Native application", ["metro.config.js"], ["package.json" => "react-native"], ["android/build", "android/app/build", "ios/build"], ["node_modules", "ios/Pods"]),
    project_type!("expo", "Expo", "Workspace, Desktop & Mobile", "Expo application", ["app.json", "app.config.js", "app.config.ts"], ["package.json" => "expo"], [".expo", "dist", "web-build"], ["node_modules"]),
    project_type!("ionic-capacitor", "Ionic / Capacitor", "Workspace, Desktop & Mobile", "Ionic or Capacitor application", ["ionic.config.json", "capacitor.config.ts", "capacitor.config.json"], ["package.json" => "@capacitor/core"], ["www", "dist", "android/build", "ios/build"], ["node_modules", "ios/App/Pods"]),
    project_type!("cordova", "Cordova", "Workspace, Desktop & Mobile", "Cordova application", ["config.xml"], ["package.json" => "cordova"], ["platforms", "plugins", "www"], ["node_modules"]),
    project_type!("nativescript", "NativeScript", "Workspace, Desktop & Mobile", "NativeScript application", ["nativescript.config.ts", "nativescript.config.js"], ["package.json" => "@nativescript/core"], ["platforms", "hooks"], ["node_modules"]),
    project_type!("flutter", "Flutter", "Workspace, Desktop & Mobile", "Flutter application", ["pubspec.yaml"], ["pubspec.yaml" => "flutter:"], ["build", ".dart_tool"], [".pub-cache", "ios/Pods"]),
    project_type!("android-gradle", "Android / Gradle", "Workspace, Desktop & Mobile", "Android Gradle application", ["settings.gradle", "settings.gradle.kts", "gradlew"], ["build.gradle" => "com.android", "build.gradle.kts" => "com.android"], [".gradle", "build", "app/build"]),
    project_type!("ios-xcode", "iOS / Xcode", "Workspace, Desktop & Mobile", "Xcode application", [], ["project.pbxproj" => "PBXProject"], ["build", "DerivedData"], ["Pods", "Carthage/Build"]),
    project_type!("dotnet", ".NET / MSBuild", "Microsoft & JVM", ".NET or MSBuild project", ["*.csproj", "*.fsproj", "*.vbproj", "*.sln"], ["global.json" => "sdk"], ["bin", "obj", ".vs", "TestResults"], ["packages"]),
    project_type!("aspnet", "ASP.NET Core", "Microsoft & JVM", "ASP.NET Core project", [], ["Program.cs" => "WebApplication", "Startup.cs" => "IApplicationBuilder"], ["bin", "obj", ".vs", "TestResults"], ["packages", "node_modules"]),
    project_type!("blazor", "Blazor", "Microsoft & JVM", "Blazor project", [], ["Program.cs" => "AddRazorComponents", "Program.cs" => "WebAssemblyHostBuilder"], ["bin", "obj", ".vs"], ["packages", "node_modules"]),
    project_type!("winui3", "WinUI 3", "Microsoft & JVM", "Windows App SDK / WinUI 3 project", [], ["Package.appxmanifest" => "uap", "App.xaml" => "Microsoft.UI.Xaml"], ["bin", "obj", ".vs", "AppPackages"], ["packages"]),
    project_type!("wpf", "WPF", "Microsoft & JVM", "WPF application", [], ["App.xaml" => "presentation", "MainWindow.xaml" => "presentation"], ["bin", "obj", ".vs"], ["packages"]),
    project_type!("winforms", "Windows Forms", "Microsoft & JVM", "Windows Forms application", [], ["Program.cs" => "Application.Run"], ["bin", "obj", ".vs"], ["packages"]),
    project_type!("maui", ".NET MAUI", "Microsoft & JVM", ".NET MAUI application", [], ["MauiProgram.cs" => "MauiApp"], ["bin", "obj", ".vs"], ["packages"]),
    project_type!("avalonia", "Avalonia", "Microsoft & JVM", "Avalonia UI application", [], ["App.axaml" => "Avalonia", "package.json" => "avalonia"], ["bin", "obj", ".vs"], ["packages", "node_modules"]),
    project_type!("uno", "Uno Platform", "Microsoft & JVM", "Uno Platform application", [], ["App.xaml" => "Uno", "global.json" => "uno"], ["bin", "obj", ".vs"], ["packages"]),
    project_type!(
        "maven",
        "Maven",
        "Microsoft & JVM",
        "Maven project",
        ["pom.xml", "mvnw"],
        [],
        ["target"]
    ),
    project_type!(
        "gradle",
        "Gradle",
        "Microsoft & JVM",
        "Gradle project",
        [
            "build.gradle",
            "build.gradle.kts",
            "settings.gradle",
            "settings.gradle.kts"
        ],
        [],
        [".gradle", "build"]
    ),
    project_type!(
        "java",
        "Java",
        "Microsoft & JVM",
        "Java project",
        ["pom.xml", "build.gradle", "build.gradle.kts"],
        [],
        ["target", "build", "out"]
    ),
    project_type!("kotlin", "Kotlin", "Microsoft & JVM", "Kotlin project", [], ["build.gradle.kts" => "kotlin", "pom.xml" => "kotlin"], ["build", "target", "out"]),
    project_type!("spring-boot", "Spring Boot", "Microsoft & JVM", "Spring Boot service", [], ["pom.xml" => "spring-boot", "build.gradle" => "spring-boot", "build.gradle.kts" => "spring-boot"], ["target", "build"]),
    project_type!(
        "rust",
        "Rust / Cargo",
        "Native & Backend",
        "Rust Cargo project",
        ["Cargo.toml"],
        [],
        ["target"],
        ["vendor"]
    ),
    project_type!(
        "go",
        "Go",
        "Native & Backend",
        "Go module",
        ["go.mod", "go.work"],
        [],
        ["bin", "build", "dist", "coverage"],
        ["vendor"]
    ),
    project_type!(
        "python",
        "Python",
        "Native & Backend",
        "Python project",
        [
            "pyproject.toml",
            "requirements.txt",
            "setup.py",
            "setup.cfg"
        ],
        [],
        [
            "__pycache__",
            ".pytest_cache",
            ".mypy_cache",
            ".ruff_cache",
            ".tox",
            "htmlcov",
            "dist",
            "build"
        ],
        [".venv", "venv", "env", ".env", "__pypackages__", ".conda"]
    ),
    project_type!(
        "uv",
        "uv",
        "Native & Backend",
        "uv-managed Python project",
        ["uv.lock"],
        [],
        [
            "__pycache__",
            ".pytest_cache",
            ".ruff_cache",
            "dist",
            "build"
        ],
        [".venv", "venv", ".uv"]
    ),
    project_type!("poetry", "Poetry", "Native & Backend", "Poetry Python project", ["poetry.lock"], ["pyproject.toml" => "[tool.poetry]"], ["__pycache__", ".pytest_cache", "dist", "build"], [".venv", "venv"]),
    project_type!("django", "Django", "Native & Backend", "Django application", ["manage.py"], ["requirements.txt" => "django", "pyproject.toml" => "django"], ["__pycache__", ".pytest_cache", "staticfiles"], [".venv", "venv", "env", ".env"]),
    project_type!("flask", "Flask", "Native & Backend", "Flask application", [], ["requirements.txt" => "flask", "pyproject.toml" => "flask"], ["__pycache__", ".pytest_cache"], [".venv", "venv", "env", ".env"]),
    project_type!("fastapi", "FastAPI", "Native & Backend", "FastAPI application", [], ["requirements.txt" => "fastapi", "pyproject.toml" => "fastapi"], ["__pycache__", ".pytest_cache"], [".venv", "venv", "env", ".env"]),
    project_type!(
        "php-composer",
        "PHP / Composer",
        "Native & Backend",
        "Composer project",
        ["composer.json", "composer.lock"],
        [],
        [
            "cache",
            "var/cache",
            "storage/framework/cache",
            "storage/framework/views"
        ],
        ["vendor"]
    ),
    project_type!("laravel", "Laravel", "Native & Backend", "Laravel application", ["artisan"], ["composer.json" => "laravel/framework"], ["bootstrap/cache", "storage/framework/cache", "storage/framework/views", "storage/framework/sessions"], ["vendor"]),
    project_type!("symfony", "Symfony", "Native & Backend", "Symfony application", ["symfony.lock"], ["composer.json" => "symfony/framework-bundle"], ["var/cache", "var/log"], ["vendor"]),
    project_type!(
        "ruby",
        "Ruby / Bundler",
        "Native & Backend",
        "Ruby Bundler project",
        ["Gemfile", "Gemfile.lock"],
        [],
        ["tmp", "log"],
        ["vendor/bundle", ".bundle"]
    ),
    project_type!("rails", "Rails", "Native & Backend", "Ruby on Rails application", ["config/application.rb", "bin/rails"], ["Gemfile" => "rails"], ["tmp/cache", "tmp/pids", "log"], ["vendor/bundle", ".bundle", "node_modules"]),
    project_type!(
        "elixir",
        "Elixir / Mix",
        "Native & Backend",
        "Elixir Mix project",
        ["mix.exs"],
        [],
        ["_build", "cover"],
        ["deps"]
    ),
    project_type!("phoenix", "Phoenix", "Native & Backend", "Phoenix application", [], ["mix.exs" => "phoenix"], ["_build", "priv/static"], ["deps", "assets/node_modules"]),
    project_type!(
        "dart",
        "Dart",
        "Native & Backend",
        "Dart project",
        ["pubspec.yaml"],
        [],
        [".dart_tool", "build"],
        [".pub-cache"]
    ),
    project_type!(
        "swiftpm",
        "Swift Package Manager",
        "Native & Backend",
        "Swift package",
        ["Package.swift"],
        [],
        [".build"],
        [".build/checkouts"]
    ),
    project_type!(
        "cmake",
        "CMake",
        "Native & Backend",
        "CMake project",
        ["CMakeLists.txt", "CMakePresets.json"],
        [],
        [
            "build",
            "cmake-build-debug",
            "cmake-build-release",
            "CMakeFiles"
        ]
    ),
    project_type!(
        "meson",
        "Meson",
        "Native & Backend",
        "Meson project",
        ["meson.build"],
        [],
        ["build", "builddir"]
    ),
    project_type!(
        "bazel",
        "Bazel",
        "Native & Backend",
        "Bazel workspace",
        ["WORKSPACE", "WORKSPACE.bazel", "MODULE.bazel"],
        [],
        ["bazel-bin", "bazel-out", "bazel-testlogs"]
    ),
    project_type!(
        "make",
        "Make",
        "Native & Backend",
        "Make project",
        ["Makefile", "makefile"],
        [],
        ["build", "dist"]
    ),
    project_type!("qt", "Qt", "Native & Backend", "Qt project", [], ["CMakeLists.txt" => "Qt", "*.pro" => "QT +="], ["build", "CMakeFiles"]),
    project_type!(
        "zig",
        "Zig",
        "Native & Backend",
        "Zig project",
        ["build.zig", "build.zig.zon"],
        [],
        ["zig-out", ".zig-cache"]
    ),
    project_type!(
        "unity",
        "Unity",
        "Game & Infrastructure",
        "Unity project",
        ["ProjectSettings/ProjectVersion.txt", "Assets"],
        [],
        ["Library", "Temp", "Obj", "Logs"]
    ),
    project_type!(
        "unreal",
        "Unreal Engine",
        "Game & Infrastructure",
        "Unreal Engine project",
        ["Config", "Content"],
        [],
        ["Binaries", "DerivedDataCache", "Intermediate", "Saved"]
    ),
    project_type!(
        "godot",
        "Godot",
        "Game & Infrastructure",
        "Godot project",
        ["project.godot"],
        [],
        [".godot", ".import"]
    ),
    project_type!(
        "docker",
        "Docker / Compose",
        "Game & Infrastructure",
        "Docker project",
        [
            "Dockerfile",
            "compose.yaml",
            "compose.yml",
            "docker-compose.yml",
            "docker-compose.yaml"
        ],
        [],
        []
    ),
    project_type!("terraform", "Terraform", "Game & Infrastructure", "Terraform project", [], [".terraform.lock.hcl" => "provider"], [".terraform", "crash.log"]),
    project_type!(
        "pulumi",
        "Pulumi",
        "Game & Infrastructure",
        "Pulumi project",
        ["Pulumi.yaml", "Pulumi.yml"],
        [],
        [".pulumi"]
    ),
    project_type!("serverless", "Serverless Framework", "Game & Infrastructure", "Serverless Framework project", ["serverless.yml", "serverless.yaml", "serverless.ts", "serverless.js"], ["package.json" => "serverless"], [".serverless"]),
];

pub(crate) fn list_project_types() -> Vec<DevProjectType> {
    PROJECT_TYPES
        .iter()
        .map(|item| DevProjectType {
            id: item.id.to_string(),
            label: item.label.to_string(),
            category: item.category.to_string(),
            description: item.description.to_string(),
        })
        .collect()
}

fn small_file_contains(path: &Path, needle: &str) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() > 2 * 1024 * 1024 {
        return false;
    }
    fs::read_to_string(path)
        .map(|value| value.to_lowercase().contains(&needle.to_lowercase()))
        .unwrap_or(false)
}

fn marker_exists(root: &Path, marker: &str) -> bool {
    if marker.contains('*') {
        let suffix = marker.trim_start_matches('*');
        return fs::read_dir(root)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().ends_with(suffix));
    }
    root.join(marker).exists()
}

pub(crate) fn scan_project_types(root: &Path) -> DevProjectTypeScan {
    let mut detected_type_ids = Vec::new();
    let mut evidence = HashMap::new();
    for definition in PROJECT_TYPES {
        let mut matches = BTreeSet::new();
        for marker in definition.markers {
            if marker_exists(root, marker) {
                matches.insert((*marker).to_string());
            }
        }
        for (file, needle) in definition.content_markers {
            if file.contains('*') {
                let suffix = file.trim_start_matches('*');
                if let Ok(entries) = fs::read_dir(root) {
                    for entry in entries.filter_map(Result::ok) {
                        if entry.file_name().to_string_lossy().ends_with(suffix)
                            && small_file_contains(&entry.path(), needle)
                        {
                            matches.insert(format!(
                                "{} contains {}",
                                entry.file_name().to_string_lossy(),
                                needle
                            ));
                        }
                    }
                }
            } else if small_file_contains(&root.join(file), needle) {
                matches.insert(format!("{file} contains {needle}"));
            }
        }
        if !matches.is_empty() {
            detected_type_ids.push(definition.id.to_string());
            evidence.insert(definition.id.to_string(), matches.into_iter().collect());
        }
    }
    DevProjectTypeScan {
        detected_type_ids,
        evidence,
    }
}

fn normalized_relative(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn directory_stats(path: &Path) -> (u64, u64) {
    let mut bytes = 0;
    let mut files = 0;
    for entry in WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_file() {
            files += 1;
            bytes += entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        }
    }
    (bytes, files)
}

fn candidate_id(relative_path: &str) -> String {
    format!("{:x}", Sha256::digest(relative_path.as_bytes()))
}

fn matches_cache_pattern(relative: &str, name: &str, pattern: &str) -> bool {
    relative == pattern
        || relative.ends_with(&format!("/{pattern}"))
        || (!pattern.contains('/') && name == pattern)
}

pub(crate) fn scan_cache(root: &Path, project_type_ids: &[String]) -> Vec<DevCacheCandidate> {
    let selected: HashSet<&str> = project_type_ids.iter().map(String::as_str).collect();
    let definitions = PROJECT_TYPES
        .iter()
        .filter(|item| selected.contains(item.id))
        .collect::<Vec<_>>();
    let mut paths: Vec<(PathBuf, Vec<String>, bool)> = Vec::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            if entry.file_type().is_symlink() {
                return false;
            }
            let name = entry.file_name().to_string_lossy();
            if name == ".git" {
                return false;
            }
            true
        });
    for entry in walker.filter_map(Result::ok) {
        if entry.depth() == 0 || !entry.file_type().is_dir() {
            continue;
        }
        let Ok(relative_path) = entry.path().strip_prefix(root) else {
            continue;
        };
        let relative = normalized_relative(relative_path);
        let name = entry.file_name().to_string_lossy();
        if paths
            .iter()
            .any(|(parent, _, _)| entry.path().starts_with(parent))
        {
            continue;
        }
        let matching_dep_types = definitions
            .iter()
            .filter(|definition| {
                definition
                    .dependency_patterns
                    .iter()
                    .any(|pattern| matches_cache_pattern(&relative, &name, pattern))
            })
            .map(|definition| definition.id.to_string())
            .collect::<Vec<_>>();
        if !matching_dep_types.is_empty() {
            paths.push((entry.path().to_path_buf(), matching_dep_types, true));
            continue;
        }
        let matching_cache_types = definitions
            .iter()
            .filter(|definition| {
                definition
                    .cache_patterns
                    .iter()
                    .any(|pattern| matches_cache_pattern(&relative, &name, pattern))
            })
            .map(|definition| definition.id.to_string())
            .collect::<Vec<_>>();
        if !matching_cache_types.is_empty() {
            paths.push((entry.path().to_path_buf(), matching_cache_types, false));
        }
    }
    paths
        .into_iter()
        .map(|(path, project_type_ids, is_dependency)| {
            let relative_path = normalized_relative(path.strip_prefix(root).unwrap_or(&path));
            let (size_bytes, file_count) = directory_stats(&path);
            DevCacheCandidate {
                id: candidate_id(&relative_path),
                relative_path,
                size_bytes,
                file_count,
                project_type_ids,
                is_dependency,
            }
        })
        .collect()
}

pub(crate) fn resolve_candidate<'a>(
    candidates: &'a [DevCacheCandidate],
    id: &str,
) -> Option<&'a DevCacheCandidate> {
    candidates.iter().find(|candidate| candidate.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn fixture(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("projects-runner-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn detects_combined_tauri_and_nextjs_project() {
        let root = fixture("detect-combined");
        fs::create_dir_all(root.join("src-tauri")).unwrap();
        fs::write(root.join("src-tauri/tauri.conf.json"), "{}").unwrap();
        fs::write(root.join("src-tauri/Cargo.toml"), "[package]").unwrap();
        fs::write(root.join("next.config.ts"), "export default {}").unwrap();
        fs::write(
            root.join("package.json"),
            r#"{"dependencies":{"next":"latest","@tauri-apps/api":"latest"}}"#,
        )
        .unwrap();
        let scan = scan_project_types(&root);
        assert!(scan.detected_type_ids.contains(&"tauri".to_string()));
        assert!(scan.detected_type_ids.contains(&"nextjs".to_string()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cache_scan_finds_cache_and_dependencies_and_deduplicates_children() {
        let root = fixture("cache-safety");
        fs::create_dir_all(root.join(".next/cache/nested")).unwrap();
        fs::write(root.join(".next/cache/nested/item.bin"), vec![1_u8; 32]).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg/dist")).unwrap();
        fs::write(root.join("node_modules/pkg/dist/item.js"), "generated").unwrap();
        let candidates = scan_cache(&root, &["nextjs".to_string(), "node".to_string()]);
        assert_eq!(candidates.len(), 2);
        let next_cand = candidates.iter().find(|c| c.relative_path == ".next").unwrap();
        assert!(!next_cand.is_dependency);
        assert_eq!(next_cand.file_count, 1);
        let node_cand = candidates.iter().find(|c| c.relative_path == "node_modules").unwrap();
        assert!(node_cand.is_dependency);
        assert_eq!(node_cand.file_count, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detects_winui3_from_manifest_and_xaml() {
        let root = fixture("detect-winui");
        fs::write(
            root.join("Package.appxmanifest"),
            "<Package xmlns:uap=\"uap\" />",
        )
        .unwrap();
        fs::write(
            root.join("App.xaml"),
            "<Application xmlns=\"using:Microsoft.UI.Xaml\" />",
        )
        .unwrap();
        let scan = scan_project_types(&root);
        assert!(scan.detected_type_ids.contains(&"winui3".to_string()));
        let _ = fs::remove_dir_all(root);
    }
}
