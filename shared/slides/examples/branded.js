const brand = {
  ink: '17324D',
  accent: '047A82',
  paper: 'F5F7FA',
  muted: '526779',
  white: 'FFFFFF',
  font: 'Aptos'
};

pptx.author = 'Philby';
pptx.subject = 'Branded slide generation example';
pptx.title = 'A clearer story';
pptx.company = 'Philby';
pptx.theme = { headFontFace: brand.font, bodyFontFace: brand.font };

pptx.defineSlideMaster({
  title: 'BRAND',
  background: { color: brand.paper },
  objects: [
    { rect: { x: 0, y: 0, w: 10, h: 0.12, fill: { color: brand.accent }, line: { color: brand.accent } } },
    { text: { text: 'PHILBY', options: { x: 0.6, y: 5.2, w: 2, h: 0.2, fontFace: brand.font, fontSize: 10, bold: true, color: brand.muted, margin: 0 } } }
  ],
  slideNumber: { x: 9.05, y: 5.2, w: 0.35, h: 0.2, fontFace: brand.font, fontSize: 10, color: brand.muted, margin: 0, align: 'right' }
});

function addSlide(title, label) {
  const slide = pptx.addSlide({ masterName: 'BRAND' });
  slide.addText(label.toUpperCase(), { x: 0.6, y: 0.48, w: 8.8, h: 0.25, fontSize: 11, bold: true, color: brand.accent, margin: 0 });
  slide.addText(title, { x: 0.6, y: 0.98, w: 8.8, h: 0.9, fontSize: 28, bold: true, color: brand.ink, margin: 0 });
  return slide;
}

const opening = addSlide('A clearer story, one revision at a time', 'Working together');
opening.addText('Turn a useful brief into a presentation that is easy to review and refine.', { x: 0.6, y: 2.15, w: 5.15, h: 1.15, fontSize: 22, color: brand.muted, margin: 0 });
opening.addShape(pptx.ShapeType.rect, { x: 6.35, y: 2.12, w: 3.05, h: 2.25, fill: { color: brand.accent }, line: { color: brand.accent } });
opening.addText('One shared\nvisual language', { x: 6.65, y: 2.55, w: 2.45, h: 1.15, fontSize: 25, bold: true, color: brand.white, margin: 0 });

const processSlide = addSlide('Keep each iteration focused', 'A simple process');
const stages = [
  ['01', 'Build', 'Use the same master, colours and fonts throughout the deck.'],
  ['02', 'Review', 'Open the presentation and check the message and visual fit.'],
  ['03', 'Refine', 'Edit the source and save the next version to a new file.']
];

stages.forEach(([number, title, body], index) => {
  const x = 0.6 + index * 3;
  processSlide.addShape(pptx.ShapeType.rect, { x, y: 2.15, w: 2.8, h: 2.45, fill: { color: brand.white }, line: { color: brand.white } });
  processSlide.addText(number, { x: x + 0.2, y: 2.38, w: 2.4, h: 0.35, fontSize: 20, bold: true, color: brand.accent, margin: 0 });
  processSlide.addText(title, { x: x + 0.2, y: 2.98, w: 2.4, h: 0.4, fontSize: 22, bold: true, color: brand.ink, margin: 0 });
  processSlide.addText(body, { x: x + 0.2, y: 3.58, w: 2.4, h: 0.8, fontSize: 15, color: brand.muted, margin: 0 });
});
