use super::*;

fn fixture() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    for directory in ["pages", "assets/sources", ".drafts/first/pages"] {
        fs::create_dir_all(root.path().join(directory)).unwrap();
    }
    fs::write(root.path().join("assets/sources/original.txt"), "Evidence").unwrap();
    fs::write(
        root.path().join(".drafts/first/summary.txt"),
        "First synthesis",
    )
    .unwrap();
    fs::write(root.path().join(".drafts/first/pages/source.md"),
        "type:: source\ndescription:: Original.\noriginal:: [Original](../assets/sources/original.txt)\n\n- Evidence.\n").unwrap();
    fs::write(
        root.path().join(".drafts/first/pages/topic.md"),
        "type:: topic\ndescription:: Topic.\nsources:: [[source]]\n\n- Finding from [[source]].\n",
    )
    .unwrap();
    root
}

#[test]
fn retries_every_interrupted_write_without_duplicate_log_entries() {
    for fail_at in 1..=6 {
        let root = fixture();
        let mut calls = 0;
        let result = publish_with(root.path(), "first", |path, content| {
            calls += 1;
            storage::replace(path, content)?;
            if calls == fail_at {
                return Err("Injected I/O failure".into());
            }
            Ok(())
        });
        assert!(result.is_err(), "failure at write {fail_at}");
        publish(root.path(), "first").unwrap();
        let log = storage::read(&root.path().join("pages/log.md")).unwrap();
        assert_eq!(log.matches("  change:: first\n").count(), 1);
        assert!(root.path().join("pages/topic.md").is_file());
        assert!(root.path().join("pages/index.md").is_file());
        assert!(!root.path().join(".graphwiki/pending").exists());
        Graph::load(root.path()).unwrap().validate().unwrap();
    }
}

#[test]
fn pending_batch_blocks_other_work_and_modified_drafts() {
    let root = fixture();
    let result = publish_with(root.path(), "first", |path, content| {
        storage::replace(path, content)?;
        Err("Injected failure".into())
    });
    assert!(result.is_err());
    assert!(require_complete(root.path()).is_err());
    fs::write(root.path().join(".drafts/first/summary.txt"), "Changed").unwrap();
    assert!(publish(root.path(), "first")
        .unwrap_err()
        .contains("unmodified"));
    assert!(!root.path().join("pages/source.md").exists());
}

fn journal_fixture() -> tempfile::TempDir {
    let root = fixture();
    fs::create_dir(root.path().join(".drafts/first/journals")).unwrap();
    fs::write(
        root.path().join(".drafts/first/journals/2026-10-18.md"),
        "- #Bloomberg [[topic]]\n",
    )
    .unwrap();
    root
}

#[test]
fn mixed_batches_recover_every_write_without_duplicate_journals_or_logs() {
    for fail_at in 1..=7 {
        let root = journal_fixture();
        let mut calls = 0;
        let result = publish_with(root.path(), "first", |path, content| {
            calls += 1;
            storage::replace(path, content)?;
            if calls == fail_at {
                return Err("Injected I/O failure".into());
            }
            Ok(())
        });
        assert!(result.is_err(), "failure at write {fail_at}");
        publish(root.path(), "first").unwrap();
        let log = storage::read(&root.path().join("pages/log.md")).unwrap();
        assert_eq!(log.matches("  change:: first\n").count(), 1);
        assert_eq!(
            storage::read(&root.path().join("journals/2026-10-18.md")).unwrap(),
            "- #Bloomberg [[topic]]\n"
        );
        assert!(!root.path().join(".graphwiki/pending").exists());
        Graph::load(root.path()).unwrap().validate().unwrap();
    }
}

#[test]
fn pending_journals_block_reads_and_reject_modified_drafts() {
    let root = journal_fixture();
    assert!(publish_with(root.path(), "first", |path, content| {
        storage::replace(path, content)?;
        Err("Injected failure".into())
    })
    .is_err());
    assert!(crate::execute("context", root.path(), "Bloomberg").is_err());
    fs::write(
        root.path().join(".drafts/first/journals/2026-10-18.md"),
        "Changed",
    )
    .unwrap();
    assert!(publish(root.path(), "first")
        .unwrap_err()
        .contains("unmodified"));
}

#[test]
fn existing_pages_only_fingerprints_and_receipts_stay_valid() {
    let root = fixture();
    let expected = "af01a1a7da37c0d7087670b687bd148f22e7aab2c42aab08e710c4b04cdb9935";
    assert_eq!(
        Batch::read(root.path(), "first").unwrap().fingerprint,
        expected
    );
    fs::create_dir_all(root.path().join(".graphwiki/receipts")).unwrap();
    fs::write(root.path().join(".graphwiki/receipts/first"), expected).unwrap();
    assert!(publish(root.path(), "first")
        .unwrap()
        .contains("already published"));
    assert!(!root.path().join("pages/topic.md").exists());
}

#[test]
fn legacy_fingerprints_keep_stem_order_for_prefixed_names() {
    let root = tempfile::tempdir().unwrap();
    let draft = root.path().join(".drafts/first");
    fs::create_dir_all(draft.join("pages")).unwrap();
    fs::write(draft.join("summary.txt"), "Prefix comparison").unwrap();
    fs::write(draft.join("pages/a.md"), "A\n").unwrap();
    fs::write(draft.join("pages/a-b.md"), "AB\n").unwrap();
    assert_eq!(
        Batch::read(root.path(), "first").unwrap().fingerprint,
        "e4b182b421c1df9481665bb592c3c38f93c2229fdf9b941f96def3327231b80c"
    );
}

#[test]
fn journal_fingerprints_include_the_destination_directory() {
    let root = journal_fixture();
    let before = Batch::read(root.path(), "first").unwrap().fingerprint;
    fs::rename(
        root.path().join(".drafts/first/journals/2026-10-18.md"),
        root.path().join(".drafts/first/pages/2026-10-18.md"),
    )
    .unwrap();
    let after = Batch::read(root.path(), "first").unwrap().fingerprint;
    assert_ne!(before, after);
}
