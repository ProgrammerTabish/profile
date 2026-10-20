/* Minimal EXIF writer: adds an APP1 "Exif" segment to a JPEG (the canvas encoder writes none).
   Fields: description, artist, copyright, software, dateTime (Date), userComment.
   Readable by Windows (Properties > Details: Authors, Copyright), exiftool, Pillow, etc. */
(function (global) {
  'use strict';

  const ASCII = 2, LONG = 4, UNDEFINED = 7;

  function asciiBytes(text) {
    const s = String(text).replace(/[^\x20-\x7e]/g, '?');
    const out = new Uint8Array(s.length + 1);          // NUL terminated
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function exifDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function entry(tag, type, bytes, count) {
    return { tag, type, bytes, count: count === undefined ? bytes.length : count };
  }

  /* TIFF block (big endian) with IFD0 and an Exif sub-IFD. */
  function buildTiff(f) {
    const date = f.dateTime instanceof Date ? f.dateTime : new Date();
    const ifd0 = [];
    if (f.description) ifd0.push(entry(0x010E, ASCII, asciiBytes(f.description)));
    if (f.software) ifd0.push(entry(0x0131, ASCII, asciiBytes(f.software)));
    ifd0.push(entry(0x0132, ASCII, asciiBytes(exifDate(date))));
    if (f.artist) ifd0.push(entry(0x013B, ASCII, asciiBytes(f.artist)));
    if (f.copyright) ifd0.push(entry(0x8298, ASCII, asciiBytes(f.copyright)));
    const exifPtr = entry(0x8769, LONG, new Uint8Array(4), 1);
    ifd0.push(exifPtr);

    const sub = [entry(0x9003, ASCII, asciiBytes(exifDate(date)))];
    if (f.userComment) {
      const text = asciiBytes(f.userComment).subarray(0, -1);
      const uc = new Uint8Array(8 + text.length);
      uc.set([0x41, 0x53, 0x43, 0x49, 0x49, 0, 0, 0]);  // "ASCII\0\0\0" character code
      uc.set(text, 8);
      sub.push(entry(0x9286, UNDEFINED, uc));
    }
    ifd0.sort((a, b) => a.tag - b.tag);

    const ifdSize = (n) => 2 + n * 12 + 4;
    const ifd0Off = 8;
    const subOff = ifd0Off + ifdSize(ifd0.length);
    let dataOff = subOff + ifdSize(sub.length);
    const extra = (e) => (e.bytes.length > 4 ? e.bytes.length + (e.bytes.length & 1) : 0);
    const total = dataOff + ifd0.concat(sub).reduce((s, e) => s + extra(e), 0);

    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    buf.set([0x4D, 0x4D, 0x00, 0x2A]);                 // "MM", 42
    dv.setUint32(4, ifd0Off);
    new DataView(exifPtr.bytes.buffer).setUint32(0, subOff);

    function writeIfd(off, entries) {
      dv.setUint16(off, entries.length);
      entries.forEach((e, i) => {
        const p = off + 2 + i * 12;
        dv.setUint16(p, e.tag);
        dv.setUint16(p + 2, e.type);
        dv.setUint32(p + 4, e.count);
        if (e.bytes.length <= 4) {
          buf.set(e.bytes, p + 8);
        } else {
          dv.setUint32(p + 8, dataOff);
          buf.set(e.bytes, dataOff);
          dataOff += extra(e);
        }
      });
      dv.setUint32(off + 2 + entries.length * 12, 0);  // no next IFD
    }
    writeIfd(ifd0Off, ifd0);
    writeIfd(subOff, sub);
    return buf;
  }

  /* Returns a new Uint8Array: the JPEG with the EXIF segment after SOI (and after JFIF APP0 if present). */
  function insertExif(jpeg, fields) {
    jpeg = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
    if (jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) throw new Error('not a JPEG');
    const tiff = buildTiff(fields);
    const seg = new Uint8Array(4 + 6 + tiff.length);
    const len = 2 + 6 + tiff.length;
    if (len > 0xFFFF) throw new Error('EXIF too large');
    seg.set([0xFF, 0xE1, len >> 8, len & 0xFF, 0x45, 0x78, 0x69, 0x66, 0, 0]);  // APP1 "Exif\0\0"
    seg.set(tiff, 10);

    let at = 2;
    if (jpeg[2] === 0xFF && jpeg[3] === 0xE0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
    // drop an existing Exif APP1 right there, if any
    let skip = 0;
    if (jpeg[at] === 0xFF && jpeg[at + 1] === 0xE1 && jpeg[at + 4] === 0x45 && jpeg[at + 5] === 0x78) {
      skip = 2 + ((jpeg[at + 2] << 8) | jpeg[at + 3]);
    }
    const out = new Uint8Array(jpeg.length - skip + seg.length);
    out.set(jpeg.subarray(0, at), 0);
    out.set(seg, at);
    out.set(jpeg.subarray(at + skip), at + seg.length);
    return out;
  }

  global.Exif = { insertExif, buildTiff };
  if (typeof module !== 'undefined') module.exports = global.Exif;
})(typeof window !== 'undefined' ? window : globalThis);
