export const FABRICS = {
  jersey: { map: 'assets/tex/jersey_n.jpg', repeat: 7, normal: 0.45, rough: 0.92, sheen: 0.7 },
  knit:   { map: 'assets/tex/knit_n.jpg',   repeat: 2.4, normal: 1.1, rough: 0.97, sheen: 1.0 },
  linen:  { map: 'assets/tex/linen_n.jpg',  repeat: 3.2, normal: 0.7, rough: 0.88, sheen: 0.5 },
  pique:  { map: 'assets/tex/pique_n.jpg',  repeat: 6.5, normal: 0.6, rough: 0.9,  sheen: 0.7 },
};

const D = {
  tee: {
    line: 'Jersey — 01', name: 'Le T-shirt', fabric: 'jersey', price: 180,
    desc: 'A heavyweight tee cut generously through the shoulder, in a dense long-staple cotton jersey that softens with every wash.',
    details: [['Fabric', '100% Supima cotton, 240 g'], ['Fit', 'Relaxed, dropped shoulder'], ['Made in', 'Portugal']],
  },
  knit: {
    line: 'Maille — 02', name: 'Le Pull Côtelé', fabric: 'knit', price: 420,
    desc: 'A ribbed crewneck knitted slowly on vintage machines from a brushed merino and cashmere blend. Warm, light, quietly structured.',
    details: [['Fabric', '80% merino, 20% cashmere'], ['Fit', 'Easy, ribbed cuffs and hem'], ['Made in', 'Scotland']],
  },
  linen: {
    line: 'Lin — 03', name: 'La Chemise de Lin', fabric: 'linen', price: 340,
    desc: 'Washed Normandy linen with a soft collar, horn buttons and a long, easy body. Made to be worn open, tucked or not at all.',
    details: [['Fabric', '100% Normandy linen'], ['Buttons', 'Natural horn'], ['Made in', 'Italy']],
  },
  polo: {
    line: 'Piqué — 04', name: 'Le Polo', fabric: 'pique', price: 260,
    desc: 'A three-button polo in a fine cotton piqué, with a soft knitted collar and a clean, slightly boxy body.',
    details: [['Fabric', '100% organic cotton piqué'], ['Buttons', 'Mother-of-pearl'], ['Made in', 'Portugal']],
  },
};

const C = [
  ['tee', 'Espresso', '#3B281E', '#E9D9C4'],
  ['knit', 'Avoine', '#D6C3A2', '#5A3E2B'],
  ['linen', 'Ivoire', '#EAE1D0', '#EADCC3'],
  ['polo', 'Caramel', '#9E6A3C', '#EAD7BC'],
  ['tee', 'Sable', '#CBB596', '#3B281E'],
  ['knit', 'Moka', '#5E4231', '#E3CFB4'],
  ['linen', 'Tabac', '#86583A', '#EBDCC4'],
  ['polo', 'Crème', '#E7DCC7', '#E7DCC7'],
];

export const ITEMS = C.map(([model, color, hex, button], i) => ({
  id: `${model}-${color.toLowerCase().replace(/[^a-z]/g, '')}`,
  model, color, hex, button: model === 'linen' ? '#D9C6A6' : (model === 'polo' ? '#F2ECE2' : button), index: i, ...D[model],
}));

export const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
