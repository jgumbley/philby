use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};
use unicode_width::UnicodeWidthChar;

use crate::{graph::Graph, page::Page};

#[derive(Clone)]
pub enum Target {
    Page(String),
    Web(String),
    Missing(String),
}

pub struct Cell {
    pub text: char,
    pub width: usize,
    pub link: Option<usize>,
}

#[derive(Default)]
pub struct Document {
    pub rows: Vec<Vec<Cell>>,
    pub links: Vec<Target>,
}

impl Document {
    pub fn append(&mut self, text: &str, link: Option<usize>, width: usize) {
        if self.rows.is_empty() {
            self.rows.push(Vec::new());
        }
        for character in text.chars() {
            self.character(character, link, width);
        }
    }

    fn character(&mut self, text: char, link: Option<usize>, width: usize) {
        if text == '\n' {
            self.rows.push(Vec::new());
            return;
        }
        if text.is_control() {
            return;
        }
        let size = UnicodeWidthChar::width(text).unwrap_or(0);
        let row_width: usize = self
            .rows
            .last()
            .unwrap()
            .iter()
            .map(|cell| cell.width)
            .sum();
        if row_width + size > width {
            self.rows.push(Vec::new());
        }
        self.rows.last_mut().unwrap().push(Cell {
            text,
            width: size,
            link,
        });
    }

    pub fn linked(&mut self, text: &str, target: Target, width: usize) {
        let index = self.links.len();
        self.links.push(target);
        self.append(text, Some(index), width);
    }

    pub fn article(graph: &Graph, page: &Page, width: usize) -> Self {
        let mut document = Self::default();
        document.append(&format!("{}\n\n", page.title()), None, width);
        document.markdown(graph, page, width);
        document.append("\n\nLinked from\n", None, width);
        let title = page.title().to_lowercase();
        for backlink in graph
            .pages
            .values()
            .filter(|p| !p.system() && p.references.contains(&title))
        {
            document.linked(backlink.title(), Target::Page(backlink.key()), width);
            document.append("\n", None, width);
        }
        document
    }

    fn markdown(&mut self, graph: &Graph, page: &Page, width: usize) {
        let mut offset = 0;
        for (event, range) in
            Parser::new_ext(&page.content, Options::ENABLE_WIKILINKS).into_offset_iter()
        {
            if let Event::Start(Tag::Link {
                link_type,
                dest_url,
                ..
            }) = event
            {
                self.append(&page.content[offset..range.start], None, width);
                self.linked(
                    &page.content[range.clone()],
                    resolve(graph, page, link_type, &dest_url),
                    width,
                );
                offset = range.end;
            }
        }
        self.append(&page.content[offset..], None, width);
    }

    pub fn catalogue(graph: &Graph, journals: bool, width: usize) -> Self {
        let mut document = Self::default();
        let title = if journals {
            "Journal — evidence at write time\n\n"
        } else {
            "Wiki — linked articles\n\n"
        };
        document.append(title, None, width);
        let mut pages: Vec<_> = graph
            .pages
            .values()
            .filter(|p| !p.system() && p.journal() == journals)
            .collect();
        if journals {
            pages.reverse();
        }
        for page in pages {
            document.linked(page.title(), Target::Page(page.key()), width);
            document.append("\n", None, width);
        }
        if document.links.is_empty() {
            document.append("No published documents yet.\n", None, width);
        }
        document
    }
}

fn resolve(graph: &Graph, page: &Page, kind: LinkType, target: &str) -> Target {
    if target.starts_with("https://") || target.starts_with("http://") {
        return Target::Web(target.into());
    }
    let resolved = if matches!(kind, LinkType::WikiLink { .. }) {
        graph.resolve(target)
    } else {
        relative(graph, page, target)
    };
    resolved
        .map(|p| Target::Page(p.key()))
        .unwrap_or_else(|| Target::Missing(target.into()))
}

fn relative<'a>(graph: &'a Graph, page: &Page, target: &str) -> Option<&'a Page> {
    let path = target.split('#').next()?.trim_end_matches(".md");
    let key = match path.strip_prefix("../") {
        Some(path) => path.to_string(),
        None => format!("{}/{}", page.directory, path.trim_start_matches("./")),
    };
    graph.pages.get(&key)
}
