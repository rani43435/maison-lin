export const MODELS = {
  tee:   { upper: 0.299, fore: 0.26, short: true, detailTex: 'jersey', detailRepeat: 22, shoulderY: 1.39, shoulderW: 0.33, detail: false, extra: 'jersey', extraRepeat: 14, extraScale: 0.35 },
  knit:  { upper: 0.30, fore: 0.254, detailTex: 'knit', detailRepeat: 9, shoulderY: 1.379, shoulderW: 0.33, detail: false },
  polo:  { upper: 0.319, fore: 0.289, detailTex: 'pique', detailRepeat: 20, shoulderY: 1.38, shoulderW: 0.34, detail: false, extra: 'pique', extraRepeat: 18, extraScale: 0.5 },
  linen: { upper: 0.299, fore: 0.262, short: true, detailTex: 'linen', detailRepeat: 12, shoulderY: 1.38, shoulderW: 0.32, detail: true },
  hoodie: { upper: 0.238, fore: 0.226, detailTex: 'fleece', detailRepeat: 14, shoulderY: 1.45, shoulderW: 0.32, detail: true },
  'hoodie-pocket': { upper: 0.279, fore: 0.26, detailTex: 'fleece', detailRepeat: 14, shoulderY: 1.44, shoulderW: 0.30, detail: false, extra: 'fleece', extraRepeat: 9, extraScale: 0.3 },
};

export const CREDITS = [
  ['Basic sweatshirt', 'Alexander Kurmanin', 'https://sketchfab.com/3d-models/basic-sweatshirt-92800a4c11ce4b8daccb75e60035535f'],
  ['Realistic Yellow Polo Shirt', 'MotionStudioArts', 'https://sketchfab.com/3d-models/realistic-yellow-polo-shirt-eafdb4b360f04e839df432bf7ed23877'],
  ['HoodieBaseModel', 'Marashe', 'https://sketchfab.com/3d-models/hoodiebasemodel-340b9e30d622464d8a27bd732ab8b75a'],
  ['Oversized Hoodie', 'Kaze', 'https://sketchfab.com/3d-models/oversized-hoodie-9028edd9f27e4b79b9d00b7a250acb03'],
];

export const FABRICS = {
  jersey: { map: 'assets/tex/jersey_n.jpg', repeat: 7, normal: 0.45, rough: 0.92, sheen: 0.7 },
  knit:   { map: 'assets/tex/knit_n.jpg',   repeat: 2.4, normal: 1.1, rough: 0.97, sheen: 1.0 },
  linen:  { map: 'assets/tex/linen_n.jpg',  repeat: 3.2, normal: 0.7, rough: 0.88, sheen: 0.5 },
  fleece: { map: 'assets/tex/fleece_n.jpg', repeat: 9, normal: 0.6, rough: 0.97, sheen: 1.0 },
  pique:  { map: 'assets/tex/pique_n.jpg',  repeat: 6.5, normal: 0.6, rough: 0.9,  sheen: 0.7 },
};

const D = {
  tee: {
    line: 'Jersey — 01', name: 'Le T-shirt', fabric: 'jersey', price: 180,
    desc: 'A heavyweight tee cut generously through the shoulder, in a dense long-staple cotton jersey that softens with every wash.',
    details: [['Fabric', '100% Supima cotton, 240 g'], ['Fit', 'Relaxed, dropped shoulder'], ['Made in', 'Portugal']],
  },
  knit: {
    line: 'Maille — 01', name: 'Le Pull Côtelé', fabric: 'knit', price: 420,
    desc: 'A ribbed crewneck knitted slowly on vintage machines from a brushed merino and cashmere blend. Warm, light, quietly structured.',
    details: [['Fabric', '80% merino, 20% cashmere'], ['Fit', 'Easy, ribbed cuffs and hem'], ['Made in', 'Scotland']],
  },
  linen: {
    line: 'Lin — 03', name: 'La Chemise de Lin', fabric: 'linen', price: 340,
    desc: 'Washed Normandy linen with a soft collar, horn buttons and a long, easy body. Made to be worn open, tucked or not at all.',
    details: [['Fabric', '100% Normandy linen'], ['Buttons', 'Natural horn'], ['Made in', 'Italy']],
  },
  hoodie: {
    line: 'Molleton — 03', name: 'Le Hoodie Ample', fabric: 'fleece', price: 290,
    desc: 'A deliberately oversized hoodie in a heavy brushed-back cotton fleece. Dropped shoulders, a deep hood and a long, easy body.',
    details: [['Fabric', '100% organic cotton fleece, 480 g'], ['Fit', 'Oversized, dropped shoulder'], ['Made in', 'Portugal']],
  },
  'hoodie-pocket': {
    line: 'Molleton — 04', name: 'Le Hoodie Poche', fabric: 'fleece', price: 260,
    desc: 'A wide, boxy hoodie with a kangaroo pocket and ribbed cuffs, cut from a soft loopback fleece that keeps its shape.',
    details: [['Fabric', '90% cotton, 10% cashmere fleece'], ['Fit', 'Wide and boxy'], ['Made in', 'Portugal']],
  },
  polo: {
    line: 'Piqué — 02', name: 'Le Polo', fabric: 'pique', price: 260,
    desc: 'A three-button polo in a fine cotton piqué, with a soft knitted collar and a clean, slightly boxy body.',
    details: [['Fabric', '100% organic cotton piqué'], ['Buttons', 'Mother-of-pearl'], ['Made in', 'Portugal']],
  },
};

const C = [
  ['knit', 'Avoine', '#D6C3A2', '#5A3E2B'],
  ['polo', 'Caramel', '#9E6A3C', '#EAD7BC'],
  ['knit', 'Moka', '#5E4231', '#E3CFB4'],
  ['polo', 'Crème', '#E7DCC7', '#E7DCC7'],
  ['hoodie', 'Taupe', '#8C7B6B', '#8C7B6B'],
  ['hoodie-pocket', 'Chocolat', '#4A3328', '#4A3328'],
  ['hoodie', 'Lin', '#DCD0BC', '#DCD0BC'],
  ['hoodie-pocket', 'Camel', '#B08A5E', '#B08A5E'],
];

export const ITEMS = C.map(([model, color, hex, button], i) => ({
  id: `${model}-${color.toLowerCase().replace(/[^a-z]/g, '')}`,
  model, color, hex, button: model === 'linen' ? '#D9C6A6' : (model === 'polo' ? '#F2ECE2' : button), index: i, ...D[model],
}));

export const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
// how each size scales the garment around the body (try-on)
export const SIZE_SCALE = { XS: 0.9, S: 0.95, M: 1.0, L: 1.06, XL: 1.12 };
