mod document;
mod screen;

use std::{fs::OpenOptions, path::Path};

use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind, MouseButton, MouseEventKind},
    terminal,
};
use fs2::FileExt;

use crate::{graph::Graph, publish, Result};
use document::{Document, Target};

const HELP: &str =
    "Click links | Tab/Enter | arrows/PgUp/PgDn | w wiki | j journal | b back | r refresh | q quit";

#[derive(Clone, Default)]
struct Location {
    page: Option<String>,
    journals: bool,
    offset: usize,
}

struct Viewer {
    graph: Graph,
    location: Location,
    history: Vec<Location>,
    selected: Option<usize>,
    message: String,
}

pub fn run(root: &Path) -> Result<()> {
    let graph = load(root)?;
    let _terminal = screen::Terminal::open().map_err(|e| e.to_string())?;
    let mut viewer = Viewer {
        graph,
        location: Location::default(),
        history: Vec::new(),
        selected: None,
        message: HELP.into(),
    };
    viewer.run(root).map_err(|e| e.to_string())
}

fn load(root: &Path) -> Result<Graph> {
    let _lock = lock()?;
    publish::require_complete(root)?;
    let graph = Graph::load(root)?;
    graph.validate()?;
    Ok(graph)
}

fn lock() -> Result<std::fs::File> {
    let lock = std::env::var("GRAPHWIKI_LOCK")
        .map_err(|_| "Use make wiki-browse to supply the graph lock")?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock)
        .map_err(|e| e.to_string())?;
    FileExt::lock_shared(&file).map_err(|e| e.to_string())?;
    Ok(file)
}

impl Viewer {
    fn run(&mut self, root: &Path) -> std::io::Result<()> {
        loop {
            let document = self.draw()?;
            if !self.event(event::read()?, &document, root) {
                return Ok(());
            }
        }
    }

    fn draw(&mut self) -> std::io::Result<Document> {
        let document = self.document(terminal::size()?.0.saturating_sub(1).max(1) as usize);
        self.location.offset = self
            .location
            .offset
            .min(document.rows.len().saturating_sub(1));
        screen::draw(
            &document,
            self.location.offset,
            self.selected,
            &self.message,
        )?;
        Ok(document)
    }

    fn document(&self, width: usize) -> Document {
        if let Some(page) = self
            .location
            .page
            .as_ref()
            .and_then(|key| self.graph.pages.get(key))
        {
            return Document::article(&self.graph, page, width);
        }
        Document::catalogue(&self.graph, self.location.journals, width)
    }

    fn event(&mut self, event: Event, document: &Document, root: &Path) -> bool {
        match event {
            Event::Key(key) if key.kind == KeyEventKind::Press => {
                self.key(key.code, document, root);
                key.code != KeyCode::Char('q')
            }
            Event::Mouse(mouse) => {
                self.mouse(mouse, document);
                true
            }
            _ => true,
        }
    }

    fn key(&mut self, key: KeyCode, document: &Document, root: &Path) {
        match key {
            KeyCode::Char('w') => self.navigate(Location::default()),
            KeyCode::Char('j') => self.navigate(Location {
                journals: true,
                ..Location::default()
            }),
            KeyCode::Char('r') => self.refresh(root),
            _ => self.navigation_key(key, document),
        }
    }

    fn navigation_key(&mut self, key: KeyCode, document: &Document) {
        match key {
            KeyCode::Char('b') | KeyCode::Backspace => self.back(),
            KeyCode::Tab => self.select_next(document),
            KeyCode::Enter => self.activate(self.selected, document),
            _ => self.scroll_key(key),
        }
    }

    fn scroll_key(&mut self, key: KeyCode) {
        let delta = [
            (KeyCode::Up, -1),
            (KeyCode::Down, 1),
            (KeyCode::PageUp, -10),
            (KeyCode::PageDown, 10),
        ]
        .into_iter()
        .find(|(code, _)| *code == key)
        .map_or(0, |(_, delta)| delta);
        self.scroll(delta);
    }

    fn scroll(&mut self, delta: isize) {
        self.location.offset = self.location.offset.saturating_add_signed(delta);
    }

    fn navigate(&mut self, location: Location) {
        self.history.push(self.location.clone());
        self.location = location;
        self.selected = None;
        self.message = HELP.into();
    }

    fn back(&mut self) {
        if let Some(location) = self.history.pop() {
            self.location = location;
            self.selected = None;
            self.message = HELP.into();
        }
    }

    fn refresh(&mut self, root: &Path) {
        match load(root) {
            Ok(graph) => {
                self.graph = graph;
                self.selected = None;
                self.message = HELP.into();
            }
            Err(error) => self.message = error,
        }
    }

    fn select_next(&mut self, document: &Document) {
        if document.links.is_empty() {
            return;
        }
        let next = self.selected.map(|i| i + 1).unwrap_or(0) % document.links.len();
        self.selected = Some(next);
        self.location.offset = document
            .rows
            .iter()
            .position(|row| row.iter().any(|cell| cell.link == Some(next)))
            .unwrap_or(0);
    }

    fn activate(&mut self, link: Option<usize>, document: &Document) {
        match link.and_then(|i| document.links.get(i)) {
            Some(Target::Page(key)) => self.navigate(Location {
                page: Some(key.clone()),
                ..Location::default()
            }),
            Some(Target::Web(url)) => self.message = format!("Ctrl+click to open source: {url}"),
            Some(Target::Missing(target)) => self.message = format!("Unresolved link: {target}"),
            None => (),
        }
    }

    fn mouse(&mut self, mouse: event::MouseEvent, document: &Document) {
        match mouse.kind {
            MouseEventKind::ScrollUp => self.scroll(-3),
            MouseEventKind::ScrollDown => self.scroll(3),
            MouseEventKind::Down(MouseButton::Left) => self.click(mouse, document),
            _ => (),
        }
    }

    fn click(&mut self, mouse: event::MouseEvent, document: &Document) {
        if mouse.row == 0 {
            self.header(mouse.column);
            return;
        }
        self.activate(
            screen::clicked(document, self.location.offset, mouse.column, mouse.row),
            document,
        );
    }

    fn header(&mut self, column: u16) {
        match column {
            0..=7 => self.navigate(Location::default()),
            9..=19 => self.navigate(Location {
                journals: true,
                ..Location::default()
            }),
            21..=28 => self.back(),
            _ => (),
        }
    }
}
