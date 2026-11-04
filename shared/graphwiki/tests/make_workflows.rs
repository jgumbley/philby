#![cfg(unix)]

use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

fn fixture(root: &Path) {
    let engine = Path::new(env!("CARGO_MANIFEST_DIR"));
    for relative in [
        "AGENTS.md",
        "README.md",
        "DECISIONS.md",
        "Makefile",
        "common.mk",
        "wiki.mjs",
        "clipboard.mk",
        "Cargo.toml",
        "Cargo.lock",
        ".clippy.toml",
        "rustfmt.toml",
        "tests/fixtures/consumer.mk",
    ] {
        let destination = root.join("engine").join(relative);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::copy(engine.join(relative), destination).unwrap();
    }
    for directory in ["pages", "journals", "logseq", "engine/src", "engine/tests"] {
        fs::create_dir_all(root.join(directory)).unwrap();
    }
    fs::copy(
        engine.join("tests/fixtures/consumer.mk"),
        root.join("Makefile"),
    )
    .unwrap();
    fs::write(root.join("AGENTS.md"), "Use ordinary Markdown.\n").unwrap();
    fs::write(root.join("README.md"), "# An isolated consumer graph\n").unwrap();
    fs::write(
        root.join("logseq/config.edn"),
        "{:preferred-format :markdown}\n",
    )
    .unwrap();
    fs::write(root.join("pages/example.md"), "- A published page.\n").unwrap();
    fs::write(root.join("engine/src/main.rs"), "fn main() {}\n").unwrap();
}

fn fixture_binary(directory: &Path, source: &str, name: &str) -> PathBuf {
    let receiver = directory.join(name);
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join(source);
    let output = Command::new("rustc")
        .arg(source)
        .arg("-o")
        .arg(&receiver)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    receiver
}

fn clipboard_receiver(directory: &Path) -> PathBuf {
    let receiver = fixture_binary(directory, "tests/fixtures/clipboard.rs", "pbcopy");
    for name in ["wl-copy", "xclip", "uname"] {
        fs::copy(&receiver, directory.join(name)).unwrap();
    }
    receiver
}

fn make_command(root: &Path, arguments: &[&str], receiver: &Path, clipboard: &Path) -> Command {
    let old_path = env::var_os("PATH").unwrap();
    let paths = std::iter::once(receiver.parent().unwrap().to_path_buf())
        .chain(env::split_paths(&old_path));
    let mut command = Command::new("make");
    command
        .args(["--no-print-directory", "-s"])
        .args(arguments)
        .current_dir(root)
        .env_remove("MAKEFLAGS")
        .env("PATH", env::join_paths(paths).unwrap())
        .env("GRAPHWIKI_CLIPBOARD_FILE", clipboard)
        .env(
            "GRAPHWIKI_CLIPBOARD_CALLS",
            clipboard.with_extension("calls"),
        )
        .env("GRAPHWIKI_CLIPBOARD_PLATFORM", "Linux")
        .env("WAYLAND_DISPLAY", "isolated-wayland")
        .env_remove("DISPLAY")
        .env_remove("GRAPHWIKI_CLIPBOARD_FAIL")
        .env("CARGO", receiver.parent().unwrap().join("cargo"))
        .env("CARGO_TARGET_DIR", root.join("custom target"))
        .env("GRAPHWIKI_EXPECTED_TARGET_DIR", root.join("custom target"))
        .env("GRAPHWIKI_BINARY", env!("CARGO_BIN_EXE_graphwiki"));
    command
}

fn make(root: &Path, arguments: &[&str], receiver: &Path, clipboard: &Path) -> Output {
    make_command(root, arguments, receiver, clipboard)
        .output()
        .unwrap()
}

#[test]
fn both_ingest_targets_copy_exactly_their_scoped_digest() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("graph");
    fixture(&root);
    let receiver = clipboard_receiver(workspace.path());
    let clipboard = workspace.path().join("clipboard.txt");
    for scope in [root.clone(), root.join("engine")] {
        let digest = make(&scope, &["digest"], &receiver, &clipboard);
        assert!(
            digest.status.success(),
            "{}",
            String::from_utf8_lossy(&digest.stderr)
        );
        let ingest = make(&scope, &["ingest"], &receiver, &clipboard);
        assert!(
            ingest.status.success(),
            "{}",
            String::from_utf8_lossy(&ingest.stderr)
        );
        assert_eq!(fs::read(&clipboard).unwrap(), digest.stdout);
    }
    let root_digest = make(&root, &["digest"], &receiver, &clipboard).stdout;
    let engine_digest = make(&root.join("engine"), &["digest"], &receiver, &clipboard).stdout;
    assert!(!String::from_utf8_lossy(&root_digest).contains("fn main() {}"));
    assert!(!String::from_utf8_lossy(&engine_digest).contains("- A published page."));
}

#[test]
fn ingest_selects_the_desktop_clipboard_on_macos_wayland_and_x11() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("graph");
    fixture(&root);
    let receiver = clipboard_receiver(workspace.path());
    let clipboard = workspace.path().join("clipboard.txt");
    let digest = make(&root, &["digest"], &receiver, &clipboard).stdout;
    for (platform, wayland, expected) in [
        ("Darwin", "", "pbcopy"),
        ("Linux", "isolated-wayland", "wl-copy"),
        ("Linux", "", "xclip"),
    ] {
        fs::write(clipboard.with_extension("calls"), "").unwrap();
        let output = make_command(&root, &["ingest"], &receiver, &clipboard)
            .env("GRAPHWIKI_CLIPBOARD_PLATFORM", platform)
            .env("WAYLAND_DISPLAY", wayland)
            .env("DISPLAY", ":isolated")
            .output()
            .unwrap();
        assert!(output.status.success(), "{:?}", output.stderr);
        assert_eq!(fs::read(&clipboard).unwrap(), digest);
        assert_eq!(
            fs::read_to_string(clipboard.with_extension("calls")).unwrap(),
            format!("{expected}\n")
        );
    }
}

#[test]
fn unsupported_desktops_leave_the_clipboard_untouched() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("graph");
    fixture(&root);
    let receiver = clipboard_receiver(workspace.path());
    let clipboard = workspace.path().join("clipboard.txt");
    fs::write(&clipboard, "Previous clipboard contents").unwrap();
    for platform in ["Linux", "Unsupported"] {
        let output = make_command(&root, &["ingest"], &receiver, &clipboard)
            .env("GRAPHWIKI_CLIPBOARD_PLATFORM", platform)
            .env_remove("WAYLAND_DISPLAY")
            .env_remove("DISPLAY")
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(!clipboard.with_extension("calls").exists());
        assert_eq!(
            fs::read_to_string(&clipboard).unwrap(),
            "Previous clipboard contents"
        );
    }
}

#[test]
fn failed_clipboard_commands_do_not_try_another_backend() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("graph");
    fixture(&root);
    let receiver = clipboard_receiver(workspace.path());
    let clipboard = workspace.path().join("clipboard.txt");
    fs::write(&clipboard, "Previous clipboard contents").unwrap();
    let output = make_command(&root, &["ingest"], &receiver, &clipboard)
        .env("DISPLAY", ":isolated")
        .env("GRAPHWIKI_CLIPBOARD_FAIL", "1")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert_eq!(
        fs::read_to_string(clipboard.with_extension("calls")).unwrap(),
        "wl-copy\n"
    );
    assert_eq!(
        fs::read_to_string(clipboard).unwrap(),
        "Previous clipboard contents"
    );
}

#[test]
fn a_failed_digest_does_not_replace_clipboard_contents() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("graph");
    fixture(&root);
    let receiver = clipboard_receiver(workspace.path());
    let clipboard = workspace.path().join("clipboard.txt");
    fs::write(&clipboard, "Previous clipboard contents").unwrap();
    fs::remove_file(root.join("README.md")).unwrap();
    let output = make(&root, &["ingest"], &receiver, &clipboard);
    assert!(!output.status.success());
    assert_eq!(
        fs::read_to_string(clipboard).unwrap(),
        "Previous clipboard contents"
    );
}

#[test]
fn consumer_commands_dispatch_through_cargo_with_an_explicit_graph_root() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("graph with spaces");
    fixture(&root);
    let receiver = fixture_binary(workspace.path(), "tests/fixtures/cargo.rs", "cargo");
    let clipboard = workspace.path().join("clipboard.txt");
    let output = make(
        &root,
        &["context", "QUERY=published page"],
        &receiver,
        &clipboard,
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        "--- pages/example.md ---\n- A published page.\n\n"
    );
    for target in ["index", "lint"] {
        let output = make(&root, &[target], &receiver, &clipboard);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    assert!(fs::read_to_string(root.join("pages/index.md"))
        .unwrap()
        .contains("[[example]]"));
    assert!(!clipboard.exists());
}

#[test]
fn consumer_publish_dispatches_the_change_identifier() {
    let workspace = tempfile::tempdir().unwrap();
    let root = workspace.path().join("graph");
    fixture(&root);
    let draft = root.join(".drafts/new-study");
    fs::create_dir_all(draft.join("pages")).unwrap();
    fs::write(
        draft.join("summary.txt"),
        "Add an independent study page.\n",
    )
    .unwrap();
    fs::write(
        draft.join("pages/study.md"),
        "- A historical observation.\n",
    )
    .unwrap();
    let receiver = fixture_binary(workspace.path(), "tests/fixtures/cargo.rs", "cargo");
    let clipboard = workspace.path().join("clipboard.txt");
    let output = make(
        &root,
        &["publish", "CHANGE=new-study"],
        &receiver,
        &clipboard,
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        fs::read_to_string(root.join("pages/study.md")).unwrap(),
        "- A historical observation.\n"
    );
    assert!(root.join(".graphwiki/receipts/new-study").is_file());
}
