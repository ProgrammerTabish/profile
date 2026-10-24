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
};
