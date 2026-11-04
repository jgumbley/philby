use std::ops::Range;

use pulldown_cmark::{Event, HeadingLevel, LinkType, Options, Parser, Tag};
use unicode_width::UnicodeWidthChar;

use crate::{graph::Graph, page::Page};

#[derive(Clone)]
pub enum Target {
    Page(String),
    Web(String),
    Missing(String),
}

#[derive(Clone, Copy, Default)]
pub enum Style {
    #[default]
    Plain,
    Title,
    Heading1,
    Heading2,
    Heading3,
    Strong,
    Emphasis,
    Code,
    Quote,
    Marker,
    Key,
}

#[derive(Clone, Copy, Default)]
struct Mark {
    style: Style,
    link: Option<usize>,
}

pub struct Cell {
    pub text: char,
    pub width: usize,
    pub link: Option<usize>,
    pub style: Style,
}

#[derive(Default)]
pub struct Document {
    pub rows: Vec<Vec<Cell>>,
    pub links: Vec<Target>,
    style: Style,
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
            style: self.style,
        });
    }

    fn styled(&mut self, text: &str, style: Style, width: usize) {
        self.style = style;
        self.append(text, None, width);
        self.style = Style::Plain;
    }

    pub fn linked(&mut self, text: &str, target: Target, width: usize) {
        let index = self.links.len();
        self.links.push(target);
        self.append(text, Some(index), width);
    }

    pub fn article(graph: &Graph, page: &Page, width: usize) -> Self {
        let mut document = Self::default();
        document.styled(&format!("{}\n\n", page.title()), Style::Title, width);
        document.markdown(graph, page, width);
        document.append("\n\n", None, width);
        document.styled("Linked from\n", Style::Heading2, width);
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
        let mut marks = vec![Mark::default(); page.content.len()];
        paint_styles(&mut marks, page);
        self.paint_links(graph, page, &mut marks);
        for (index, text) in page.content.char_indices() {
            self.style = marks[index].style;
            self.character(text, marks[index].link, width);
        }
        self.style = Style::Plain;
    }

    fn paint_links(&mut self, graph: &Graph, page: &Page, marks: &mut [Mark]) {
        for (event, range) in
            Parser::new_ext(&page.content, Options::ENABLE_WIKILINKS).into_offset_iter()
        {
            if let Event::Start(Tag::Link {
                link_type,
                dest_url,
                ..
            }) = event
            {
                self.links.push(resolve(graph, page, link_type, &dest_url));
                let link = Some(self.links.len() - 1);
                marks[range].iter_mut().for_each(|mark| mark.link = link);
            }
        }
    }

    pub fn catalogue(graph: &Graph, journals: bool, width: usize) -> Self {
        let mut document = Self::default();
        let title = if journals {
            "Journal — evidence at write time\n\n"
        } else {
            "Wiki — linked articles\n\n"
        };
        document.styled(title, Style::Title, width);
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

fn paint(marks: &mut [Mark], range: Range<usize>, style: Style) {
    marks[range].iter_mut().for_each(|mark| mark.style = style);
}

fn paint_styles(marks: &mut [Mark], page: &Page) {
    let parser = Parser::new_ext(&page.content, Options::ENABLE_WIKILINKS);
    for (event, range) in parser.into_offset_iter() {
        if let Some((style, range)) = styled_range(&event, range, &page.content) {
            paint(marks, range, style);
        }
    }
    paint_properties(marks, page);
}

fn paint_properties(marks: &mut [Mark], page: &Page) {
    let lines = page.content.split_inclusive('\n').scan(0, |offset, line| {
        let start = *offset;
        *offset += line.len();
        Some((start, line))
    });
    for (start, line) in lines
        .skip_while(|(_, line)| line.trim().is_empty())
        .take(page.properties.len())
    {
        let key = line.find("::").map_or(0, |index| index + 2);
        paint(marks, start..start + key, Style::Key);
    }
}

fn styled_range(
    event: &Event,
    range: Range<usize>,
    content: &str,
) -> Option<(Style, Range<usize>)> {
    if let Event::Start(Tag::Item) = event {
        let size = content[range.clone()]
            .find(char::is_whitespace)
            .unwrap_or(range.len());
        return Some((Style::Marker, range.start..range.start + size));
    }
    style_of(event).map(|style| (style, range))
}

fn style_of(event: &Event) -> Option<Style> {
    match event {
        Event::Start(tag) => block_style(tag).or_else(|| inline_style(tag)),
        Event::Code(_) => Some(Style::Code),
        Event::Rule => Some(Style::Marker),
        _ => None,
    }
}

fn block_style(tag: &Tag) -> Option<Style> {
    match tag {
        Tag::Heading { level, .. } => Some(heading(*level)),
        Tag::BlockQuote(_) => Some(Style::Quote),
        Tag::CodeBlock(_) => Some(Style::Code),
        _ => None,
    }
}

fn inline_style(tag: &Tag) -> Option<Style> {
    match tag {
        Tag::Strong => Some(Style::Strong),
        Tag::Emphasis => Some(Style::Emphasis),
        _ => None,
    }
}

fn heading(level: HeadingLevel) -> Style {
    [Style::Heading1, Style::Heading2, Style::Heading3][(level as usize).min(3) - 1]
}
