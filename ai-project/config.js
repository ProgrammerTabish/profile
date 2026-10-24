/* Settings for the data collector at /ai-project/.
   endpoint: the "Web app URL" of the Google Apps Script deployment (ends in /exec). It is not a secret:
   every request still needs the PIN, which is checked by the script on Google's side. */
window.AIP_CONFIG = {
  endpoint: 'https://script.google.com/macros/s/AKfycbw3jBoUxEuVF5vdWmNrKtxpZTqK3wNKpuUcQzmh9UDPODgyJEYbTc0SamnMlBIds1Q1zg/exec',

  // Written into every photo (EXIF Artist + Copyright + description) and into the Drive file description.
  ownerTag: 'ShaikhZakaTabish_Awais',
  project: 'Water in a bottle',

  // Used until the script answers (the script's own list is the one that counts).
  types: {
    1: { description: 'Tallest - Staatl. Fachingen (glass)', emptyWeightG: 532 },
    2: { description: 'Kondrauer (glass)', emptyWeightG: 548 },
    3: { description: 'Labertaler Stephanie Brunnen 1.0 L (PET)', emptyWeightG: 30 },
    4: { description: 'Shortest - Labertaler (glass)', emptyWeightG: 376 },
  },

  // Bottles captured with the PC tools (local Excel, not on Drive), shown next to the Drive bottles in
  // Setup > Water levels. [sample_id, bottle_type, weight_g (bottle + water), images]
  pcLevels: [
    ['S0001', 1, 1233, 44], ['S0002', 1, 1228, 90], ['S0003', 1, 1131, 101], ['S0004', 1, 1030, 124],
    ['S0005', 1, 943, 126], ['S0006', 1, 842, 90], ['S0007', 1, 794, 79], ['S0008', 1, 733, 113],
    ['S0009', 1, 818, 125], ['S0010', 1, 747, 124], ['S0011', 1, 659, 88], ['S0012', 1, 628, 72],
    ['S0013', 1, 588, 146], ['S0014', 1, 561, 156], ['S0015', 1, 532, 141],
  ],
};
