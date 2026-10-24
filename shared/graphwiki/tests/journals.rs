use std::{fs, path::Path};

use graphwiki::execute;

const JOURNAL: &str =
    "- 14:53 #Bloomberg Rates moved.\n  id:: 550e8400-e29b-41d4-a716-446655440000\n";

fn graph() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("pages")).unwrap();
    root
}

fn draft(root: &Path, change: &str, documents: &[(&str, &str)]) {
    let directory = root.join(format!(".drafts/{change}"));
    for (path, content) in documents {
        let path = directory.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }
    fs::write(directory.join("summary.txt"), "Publish updates.").unwrap();
}

#[test]
fn journal_only_batch_preserves_blocks_and_stays_out_of_catalogue() {
    let root = graph();
    draft(
        root.path(),
        "capture",
        &[("journals/2026-10-18.md", JOURNAL)],
    );
    let output = execute("publish", root.path(), "capture").unwrap();
    assert!(output.contains("journals/2026-10-18.md"));
    assert_eq!(
        fs::read_to_string(root.path().join("journals/2026-10-18.md")).unwrap(),
        JOURNAL
    );
    let context = execute("context", root.path(), "Bloomberg").unwrap();
    assert!(context.starts_with("--- journals/2026-10-18.md ---\n"));
    assert!(context.contains(JOURNAL));
    let index = fs::read_to_string(root.path().join("pages/index.md")).unwrap();
    assert!(!index.contains("2026-10-18"));
    assert_eq!(
        execute("lint", root.path(), "").unwrap(),
        "Wiki checks passed.\n"
    );
}

#[test]
fn mixed_batch_resolves_journals_and_article_links_in_both_directions() {
    let root = graph();
    let article = "title:: Rates\nsources:: [[2026-10-18]]\n\n- Synthesis.\n";
    let journal = "- 14:53 #Bloomberg [[Rates]] moved.\n";
    draft(
        root.path(),
        "mixed",
        &[
            ("pages/rates.md", article),
            ("journals/2026-10-18.md", journal),
        ],
    );
    assert!(!execute("publish", root.path(), "mixed")
        .unwrap()
        .contains("warning:"));
    let context = execute("context", root.path(), "Synthesis").unwrap();
    assert!(context.contains("--- pages/rates.md ---"));
    assert!(context.contains("--- journals/2026-10-18.md ---"));
    let index = fs::read_to_string(root.path().join("pages/index.md")).unwrap();
    assert!(index.contains("[[Rates]]"));
    assert!(!index.contains("2026-10-18"));
}

#[test]
fn equal_stems_in_different_directories_remain_distinct() {
    let root = graph();
    let article = "title:: Market day\n\n- Article.\n";
    draft(
        root.path(),
        "mixed",
        &[
            ("pages/2026-10-18.md", article),
            ("journals/2026-10-18.md", JOURNAL),
        ],
    );
    execute("publish", root.path(), "mixed").unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("pages/2026-10-18.md")).unwrap(),
        article
    );
    assert_eq!(
        fs::read_to_string(root.path().join("journals/2026-10-18.md")).unwrap(),
        JOURNAL
    );
    let context = execute("context", root.path(), "2026-10-18").unwrap();
    assert!(context.contains("--- pages/2026-10-18.md ---"));
    assert!(context.contains("--- journals/2026-10-18.md ---"));
}

#[test]
fn journal_replay_never_reverts_later_content() {
    let root = graph();
    draft(root.path(), "first", &[("journals/2026-10-18.md", JOURNAL)]);
    execute("publish", root.path(), "first").unwrap();
    let revised = format!("{JOURNAL}- 14:54 #Bloomberg Further news.\n");
    draft(
        root.path(),
        "second",
        &[("journals/2026-10-18.md", &revised)],
    );
    execute("publish", root.path(), "second").unwrap();
    assert!(execute("publish", root.path(), "first")
        .unwrap()
        .contains("already published"));
    assert_eq!(
        fs::read_to_string(root.path().join("journals/2026-10-18.md")).unwrap(),
        revised
    );
    fs::write(
        root.path().join(".drafts/first/journals/2026-10-18.md"),
        "Changed",
    )
    .unwrap();
    assert!(execute("publish", root.path(), "first")
        .unwrap_err()
        .contains("different contents"));
}

#[test]
fn journal_filenames_require_real_iso_dates() {
    for name in [
        "2026-02-30",
        "2026-1-2",
        "2026_10_18",
        "notes",
        "index",
        "log",
    ] {
        let root = graph();
        draft(
            root.path(),
            "invalid",
            &[(&format!("journals/{name}.md"), JOURNAL)],
        );
        assert!(execute("publish", root.path(), "invalid").is_err());
        assert!(!root.path().join(".graphwiki").exists());
        assert!(!root.path().join("journals").exists());
    }
}

#[test]
fn duplicate_and_reserved_journal_titles_fail_before_writing() {
    for title in ["topic", "Index", "Log"] {
        let root = graph();
        let journal = format!("title:: {title}\n\n{JOURNAL}");
        draft(
            root.path(),
            "invalid",
            &[
                ("pages/topic.md", "- Article.\n"),
                ("journals/2026-10-18.md", &journal),
            ],
        );
        assert!(execute("publish", root.path(), "invalid")
            .unwrap_err()
            .contains("Duplicate Logseq page title"));
        assert!(!root.path().join("pages/topic.md").exists());
        assert!(!root.path().join(".graphwiki").exists());
    }
}

#[test]
fn journal_warnings_and_property_errors_identify_their_directory() {
    let root = graph();
    draft(
        root.path(),
        "first",
        &[("journals/2026-10-18.md", "- [[Missing]]\n")],
    );
    let output = execute("publish", root.path(), "first").unwrap();
    assert!(output.contains("warning: journals/2026-10-18.md: unresolved [[missing]]"));
    fs::write(
        root.path().join("journals/2026-10-18.md"),
        "title:: A\ntitle:: B\n",
    )
    .unwrap();
    assert!(execute("lint", root.path(), "")
        .unwrap_err()
        .contains("journals/2026-10-18.md: duplicate page property"));
}

#[cfg(unix)]
#[test]
fn journal_directory_symlinks_are_rejected_without_touching_targets() {
    let root = graph();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("journals")).unwrap();
    draft(root.path(), "first", &[("journals/2026-10-18.md", JOURNAL)]);
    assert!(execute("publish", root.path(), "first")
        .unwrap_err()
        .contains("Symlinks"));
    assert!(execute("lint", root.path(), "")
        .unwrap_err()
        .contains("Symlinks"));
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}
