/* Großry prototype: fictional demo data.
   Prices are illustrative only. They are not supplier quotes and do not describe any real retailer. */

window.GR_DATA = (function () {
  // Every product is sold sealed, exactly as supplied: Großry never opens, weighs or re-portions a pack.
  // unit = the sealed item a student receives. ref = reference shelf price per item (retail benchmark, illustrative).
  // tiers: [collective number of items, landed price per item]
  const products = [
    { id: 'rice', name: 'Basmati rice', size: '10 kg sack', brand: 'Demo Fields', cat: 'Grains & pasta', icon: '🍚',
      unit: 'sack', pack: 1, ref: 26.00, tiers: [[5, 23.00], [10, 20.50], [20, 19.00], [40, 17.50]], demand: 17, students: 17,
      rating: 4.4, nreviews: 31, allergens: 'None', origin: 'India / Pakistan', storage: 'Dry, below 25 °C', shelf: '18 months',
      ingredients: '100% basmati rice', nutrition: '350 kcal · 7.8 g protein · 78 g carbs per 100 g', supplierPack: 'single 10 kg sack', kg: 10 },
    { id: 'pasta', name: 'Penne pasta', size: '1 kg bag', brand: 'Demo Mills', cat: 'Grains & pasta', icon: '🍝',
      unit: 'bag', pack: 1, ref: 1.80, tiers: [[20, 1.45], [50, 1.25], [120, 1.10]], demand: 64, students: 29,
      rating: 4.2, nreviews: 18, allergens: 'Gluten (wheat)', origin: 'Italy', storage: 'Dry', shelf: '24 months',
      ingredients: 'Durum wheat semolina, water', nutrition: '359 kcal · 12.5 g protein per 100 g', supplierPack: 'case of 12 bags', kg: 1 },
    { id: 'lentils', name: 'Red lentils', size: '5 kg bag', brand: 'Demo Fields', cat: 'Grains & pasta', icon: '🫘',
      unit: 'bag', pack: 1, ref: 16.00, tiers: [[4, 13.50], [10, 12.00], [20, 10.75]], demand: 7, students: 7,
      rating: 4.6, nreviews: 12, allergens: 'None', origin: 'Turkey', storage: 'Dry', shelf: '24 months',
      ingredients: 'Red lentils', nutrition: '340 kcal · 24 g protein per 100 g', supplierPack: 'single 5 kg bag', kg: 5 },
    { id: 'oats', name: 'Rolled oats', size: '1 kg bag', brand: 'Demo Mills', cat: 'Grains & pasta', icon: '🥣',
      unit: 'bag', pack: 1, ref: 1.78, tiers: [[10, 1.40], [30, 1.25], [80, 1.10]], demand: 41, students: 26,
      rating: 4.5, nreviews: 22, allergens: 'Gluten (oats)', origin: 'Germany', storage: 'Dry', shelf: '12 months',
      ingredients: 'Whole grain oat flakes', nutrition: '372 kcal · 13.5 g protein per 100 g', supplierPack: 'case of 10 bags', kg: 1 },
    { id: 'chickpeas', name: 'Chickpeas, canned', size: 'tray of 6 × 400 g', brand: 'Demo Pantry', cat: 'Pantry', icon: '🥫',
      unit: 'tray', pack: 1, ref: 5.94, tiers: [[8, 4.74], [20, 4.14], [40, 3.72]], demand: 25, students: 24,
      rating: 4.3, nreviews: 9, allergens: 'None', origin: 'Spain', storage: 'Dry', shelf: '36 months',
      ingredients: 'Chickpeas, water, salt', nutrition: '120 kcal · 7 g protein per 100 g', supplierPack: 'shrink-wrapped tray of 6 cans', kg: 2.4 },
    { id: 'passata', name: 'Tomato passata', size: '700 g jar', brand: 'Demo Pantry', cat: 'Pantry', icon: '🍅',
      unit: 'jar', pack: 1, ref: 1.29, tiers: [[30, 0.95], [90, 0.85], [180, 0.79]], demand: 96, students: 31,
      rating: 4.1, nreviews: 14, allergens: 'None', origin: 'Italy', storage: 'Dry; refrigerate after opening', shelf: '24 months',
      ingredients: 'Tomatoes, salt', nutrition: '30 kcal per 100 g', supplierPack: 'case of 12 jars', kg: 0.7 },
    { id: 'noodles', name: 'Spicy instant noodles', size: '5-pack', brand: 'Demo Noodle Co.', cat: 'Pantry', icon: '🍜',
      unit: 'pack', pack: 1, ref: 3.99, tiers: [[20, 3.10], [60, 2.80], [120, 2.55]], demand: 52, students: 33,
      rating: 4.7, nreviews: 40, allergens: 'Gluten, soy', origin: 'South Korea', storage: 'Dry', shelf: '9 months',
      ingredients: 'Wheat flour, palm oil, seasoning', nutrition: '500 kcal per serving', supplierPack: 'box of 8 packs', kg: 0.6 },
    { id: 'tuna', name: 'Tuna in brine', size: 'pack of 4 × 160 g', brand: 'Demo Sea', cat: 'Pantry', icon: '🐟',
      unit: 'pack', pack: 1, ref: 6.76, tiers: [[12, 5.16], [30, 4.60]], demand: 18, students: 15,
      rating: 4.0, nreviews: 7, allergens: 'Fish', origin: 'Thailand (MSC, demo)', storage: 'Dry', shelf: '36 months',
      ingredients: 'Skipjack tuna, water, salt', nutrition: '110 kcal · 25 g protein per 100 g', supplierPack: 'tray of 12 packs', kg: 0.64 },
    { id: 'pb', name: 'Peanut butter', size: '1 kg jar', brand: 'Demo Pantry', cat: 'Pantry', icon: '🥜',
      unit: 'jar', pack: 1, ref: 6.49, tiers: [[12, 4.99], [36, 4.49]], demand: 9, students: 8,
      rating: 4.8, nreviews: 11, allergens: 'Peanuts', origin: 'Netherlands', storage: 'Dry', shelf: '12 months',
      ingredients: 'Roasted peanuts (99%), salt', nutrition: '620 kcal · 25 g protein per 100 g', supplierPack: 'case of 6 jars', kg: 1 },
    { id: 'sunoil', name: 'Sunflower oil', size: '1 L bottle', brand: 'Demo Press', cat: 'Oils', icon: '🌻',
      unit: 'bottle', pack: 1, ref: 2.49, tiers: [[20, 1.99], [60, 1.79], [120, 1.65]], demand: 47, students: 30,
      rating: 4.2, nreviews: 10, allergens: 'None', origin: 'Hungary', storage: 'Dry, away from light', shelf: '18 months',
      ingredients: 'Refined sunflower oil', nutrition: '828 kcal per 100 ml', supplierPack: 'case of 12 bottles', kg: 0.95 },
    { id: 'olive', name: 'Olive oil, extra virgin', size: '1 L bottle', brand: 'Demo Groves', cat: 'Oils', icon: '🫒',
      unit: 'bottle', pack: 1, ref: 8.99, tiers: [[12, 7.40], [36, 6.90], [72, 6.40]], demand: 29, students: 21,
      rating: 4.6, nreviews: 16, allergens: 'None', origin: 'Spain', storage: 'Dry, away from light', shelf: '18 months',
      ingredients: 'Extra virgin olive oil', nutrition: '824 kcal per 100 ml', supplierPack: 'case of 6 bottles', kg: 0.95 },
    { id: 'oatmilk', name: 'Oat drink', size: '1 L carton', brand: 'Demo Oat', cat: 'Drinks', icon: '🥛',
      unit: 'carton', pack: 1, ref: 1.49, tiers: [[24, 1.15], [72, 0.99], [144, 0.89]], demand: 110, students: 34,
      rating: 4.3, nreviews: 25, allergens: 'Gluten (oats)', origin: 'Sweden', storage: 'Ambient; chill after opening', shelf: '9 months',
      ingredients: 'Water, oats (10%), rapeseed oil, salt', nutrition: '46 kcal per 100 ml', supplierPack: 'case of 6 cartons', kg: 1 },
    { id: 'coffee', name: 'Coffee beans', size: '1 kg bag', brand: 'Demo Roasters', cat: 'Drinks', icon: '☕',
      unit: 'bag', pack: 1, ref: 13.99, tiers: [[10, 10.90], [25, 9.90], [50, 9.20]], demand: 18, students: 15,
      rating: 4.5, nreviews: 19, allergens: 'None', origin: 'Brazil', storage: 'Dry, airtight', shelf: '12 months',
      ingredients: '100% Arabica beans', nutrition: 'n/a', supplierPack: 'case of 6 bags', kg: 1 },
    { id: 'tp', name: 'Toilet paper', size: '8 rolls', brand: 'Demo Home', cat: 'Household', icon: '🧻',
      unit: 'pack', pack: 1, ref: 3.95, tiers: [[20, 3.10], [50, 2.80], [100, 2.55]], demand: 58, students: 44,
      rating: 3.9, nreviews: 13, allergens: 'n/a', origin: 'Germany', storage: 'Dry', shelf: 'n/a',
      ingredients: 'Recycled paper, 3-ply', nutrition: 'n/a', supplierPack: 'bale of 6 packs', kg: 1 },
    { id: 'detergent', name: 'Laundry detergent', size: '2.5 L bottle (50 washes)', brand: 'Demo Home', cat: 'Household', icon: '🧴',
      unit: 'bottle', pack: 1, ref: 6.49, tiers: [[10, 4.99], [30, 4.49], [60, 3.99]], demand: 22, students: 20,
      rating: 4.1, nreviews: 8, allergens: 'Contains enzymes; see label', origin: 'Germany', storage: 'Away from children', shelf: 'n/a',
      ingredients: 'Surfactants, enzymes, perfume', nutrition: 'n/a', supplierPack: 'case of 4 bottles', kg: 2.6 },
    { id: 'frozenveg', name: 'Frozen mixed vegetables', size: '2.5 kg bag', brand: 'Demo Frost', cat: 'Chilled & frozen', icon: '🥦',
      unit: 'bag', pack: 1, ref: 5.49, tiers: [[20, 4.20], [60, 3.80]], demand: 14, students: 12,
      rating: 4.0, nreviews: 3, allergens: 'None', origin: 'Belgium', storage: 'Frozen −18 °C', shelf: '18 months frozen',
      ingredients: 'Peas, carrots, green beans, sweetcorn', nutrition: '60 kcal per 100 g', supplierPack: 'case of 4 bags', kg: 2.5,
      excluded: 'Cold-chain product. Excluded from student-run distribution until food-hygiene handling (LMHV) is reviewed. Shown so students can register interest.' }
  ];

  const reviews = {
    rice: [['Mira', 5, 'Good quality and cheaper than the supermarket. Long grains, cooks fluffy.'], ['Jonas', 4, 'Solid rice. One 10 kg sack lasts our WG about six weeks.']],
    noodles: [['Lea', 5, 'Exactly the spicy ones everyone asked for in Requests.'], ['Tariq', 4, 'Great value once the 60-pack tier unlocked.']],
    oatmilk: [['Sven', 4, 'Foams well for coffee. Fine at this price.']],
    tp: [['Anna', 3, 'It is toilet paper. Does the job.']],
    olive: [['Paolo', 5, 'Proper peppery EVOO, far better than what I usually buy.']]
  };

  const requests = [
    { id: 'r1', name: 'Korean spicy ramen (multipack)', votes: 42, goal: 50, note: '' },
    { id: 'r2', name: 'Pakistani sella basmati', votes: 28, goal: 50, note: '' },
    { id: 'r3', name: 'Jasmine rice 10 kg', votes: 21, goal: 50, note: '' },
    { id: 'r4', name: 'Halal chicken (frozen)', votes: 19, goal: 50, note: 'Needs cold chain (pending hygiene review)' },
    { id: 'r5', name: 'Paneer', votes: 11, goal: 50, note: 'Chilled (pending hygiene review)' }
  ];

  const forum = [
    { id: 'f1', cat: 'Product Reviews', title: 'Which rice is actually good?', body: 'Basmati vs jasmine for daily cooking, any experiences from last cycle?', author: 'Mira', ago: '2 h', replies: [['Tariq', 'The basmati from September was really good. Go for it.'], ['Lea', 'Jasmine if you cook a lot of Thai food, basmati for everything else.']] },
    { id: 'f2', cat: 'Requests', title: 'Can we get Pakistani basmati?', body: 'There is a request open, 28 votes so far. Please vote if you want it!', author: 'Imran', ago: '5 h', replies: [['Mod', 'If it reaches 50 votes we ask the wholesale partner for a quote.']] },
    { id: 'f3', cat: 'Deals', title: 'Olive oil tier almost unlocked', body: 'Only 7 more bottles needed for the €6.90 tier this month.', author: 'Paolo', ago: '1 d', replies: [] },
    { id: 'f4', cat: 'WGs', title: 'Anyone from Building B joining the order?', body: 'We could combine into one WG pickup and save the slot hassle.', author: 'Jonas', ago: '1 d', replies: [['Anna', 'Yes! Room B2.14, adding you to our WG group.']] },
    { id: 'f5', cat: 'Problems', title: 'My order was missing detergent', body: 'Picked up last cycle, detergent not in the box.', author: 'Sven', ago: '3 d', replies: [['Großry Support', 'Sorry! Refunded to your Großry credit. Report issues in Orders → Report a problem next time.']] }
  ];

  const history = [
    { month: 'September 2026', items: 14, paid: 68.10, saved: 17.20 },
    { month: 'August 2026', items: 11, paid: 54.30, saved: 12.90 }
  ];

  const universities = [
    { id: 'oth-aw', domain: 'oth-aw.de', name: 'OTH Amberg-Weiden', campus: ['Amberg', 'Weiden'] },
    { id: 'th-n', domain: 'th-nuernberg.de', name: 'TH Nürnberg', campus: ['Main campus', 'Kesslerplatz'] },
    { id: 'fau', domain: 'fau.de', name: 'FAU Erlangen-Nürnberg', campus: ['Erlangen South', 'Nürnberg'] },
    { id: 'oth-r', domain: 'oth-regensburg.de', name: 'OTH Regensburg', campus: ['Seybothstraße', 'Prüfening'] }
  ];

  const draftNote = '<p class="draft"><b>Draft, not legally reviewed.</b> Project-stage text. The final version needs to reflect the actual legal entity, payment provider, suppliers, data flows, food-handling model, retention periods and jurisdictions involved.</p>';

  const terms = draftNote + `
<p class="small mute">Last updated: 2 October 2026</p>
<p>These Terms and Conditions govern the use of the Großry application and related collective purchasing services.</p>
<h4>1. About Großry</h4><p>Großry is a platform designed to allow verified students to combine grocery demand, obtain collective purchasing opportunities, and coordinate collection and distribution of orders. Großry may facilitate purchasing, payment, communication, scheduling and distribution. The exact role of Großry may vary depending on the purchasing model and supplier arrangement.</p>
<h4>2. Eligibility</h4><p>Users must provide accurate registration information and must be enrolled at a participating university or otherwise meet the eligibility requirements displayed by Großry. Users are responsible for maintaining the confidentiality of their account credentials.</p>
<h4>3. Orders</h4><p>Users may add products and quantities to a monthly order. Adding an item to a cart does not necessarily guarantee that the item will ultimately be purchased. Some products may require a minimum collective quantity before the bulk purchase is activated. Großry will display relevant order deadlines and, where possible, estimated or confirmed prices.</p>
<h4>4. Prices and Savings</h4><p>Product prices shown before final procurement may be estimates until the relevant collective order is finalized. Any advertised saving will be calculated against a defined reference price or benchmark disclosed by Großry. Where Großry charges a percentage of savings, the applicable calculation method and amount will be displayed before final payment. Prices may change where supplier prices, availability, transportation costs or other procurement costs change.</p>
<h4>5. Payment</h4><p>Users may be required to pay before procurement or before collection, depending on the order model. Großry may use third-party payment providers. Payment information may be processed by those providers under their applicable terms and privacy policies.</p>
<h4>6. Cancellations</h4><p>Users may cancel or modify an order until the applicable cancellation deadline. After procurement has been committed to a supplier, cancellation may no longer be possible or may be subject to applicable costs. The applicable deadline will be displayed within the application.</p>
<h4>7. Product Availability</h4><p>Großry cannot guarantee the availability of every selected product. Where an ordered product becomes unavailable, Großry may:</p><ul><li>refund the unavailable item;</li><li>offer a replacement where the user has permitted substitutions; or</li><li>provide another remedy specified in the order information.</li></ul>
<h4>8. Product Quality and Complaints</h4><p>Users should report missing, damaged or apparently defective products through the application as soon as reasonably possible. Complaints concerning products supplied by a third party may be forwarded to the responsible supplier where appropriate.</p>
<h4>9. Order Runner Program</h4><p>Eligible users may volunteer to act as an Order Runner. An Order Runner may collect a consolidated order and assist with its distribution according to the instructions displayed in the application. Participation as an Order Runner is voluntary. Any reimbursement, grocery credit or other incentive will be displayed before acceptance of the assignment. Großry may impose eligibility requirements, limits or temporary suspension of the Order Runner function.</p>
<h4>10. Collection</h4><p>Users must collect their orders during the assigned collection period unless an alternative arrangement has been confirmed. Users may be asked to present or scan an order-specific QR code. Failure to collect an order may result in additional handling arrangements, delays or other consequences specified at checkout.</p>
<h4>11. Distribution and Food Handling</h4><p>Where Großry or its designated participants handle food, the relevant operational procedures must comply with applicable food-safety, hygiene and consumer-information requirements. Großry may exclude certain products from student-run distribution where appropriate.</p>
<h4>12. Reviews and Community Content</h4><p>Users may submit product reviews, forum posts and other content. Users must not submit unlawful, abusive, fraudulent, discriminatory, misleading or intentionally harmful content. Großry may moderate or remove content that violates these requirements.</p>
<h4>13. Account Suspension</h4><p>Großry may suspend or terminate an account where reasonably necessary because of fraud, misuse, repeated non-payment, abuse of other users, manipulation of orders or violation of these Terms.</p>
<h4>14. Limitation of Responsibility</h4><p>Großry will take reasonable measures to operate the platform and coordinate orders but cannot guarantee uninterrupted availability, supplier availability or that every expected saving will be achieved. Where a third-party supplier, payment provider, transport provider or other service is involved, that third party may have additional terms and responsibilities. Nothing in these Terms limits any rights or liability that cannot legally be excluded.</p>
<h4>15. Privacy</h4><p>The processing of personal data is governed by the Großry Privacy Policy.</p>
<h4>16. Changes</h4><p>Großry may update these Terms where necessary. Material changes will be communicated through an appropriate channel.</p>
<h4>17. Governing Law</h4><p>The applicable governing law, consumer rights and dispute-resolution arrangements will be specified in the final legally reviewed version of these Terms.</p>
<h4>18. Contact</h4><p>Questions concerning these Terms may be directed to: Großry, [Legal entity name], [Business address], [Email address].</p>`;

  const privacy = draftNote + `
<p class="small mute">Last updated: 2 October 2026</p>
<p>This Privacy Policy explains how Großry processes personal data when users register for and use the Großry application.</p>
<h4>1. Data Controller</h4><p>[Legal entity name], [Address], [Contact email]</p>
<h4>2. Information We Collect</h4><p>Depending on how the service is configured, Großry may collect:</p><ul><li>full name;</li><li>university email address;</li><li>telephone number;</li><li>university and campus;</li><li>account credentials;</li><li>profile photograph, where enabled;</li><li>grocery selections and order history;</li><li>payment and transaction information;</li><li>collection and distribution information;</li><li>product reviews and forum contributions;</li><li>technical information required to operate and secure the application.</li></ul><p>Großry should only collect information that is necessary for defined purposes.</p>
<h4>3. Why We Process Data</h4><p>Personal data may be used to:</p><ul><li>create and administer user accounts;</li><li>verify student eligibility;</li><li>process grocery orders;</li><li>coordinate collection and distribution;</li><li>communicate regarding orders;</li><li>process payments and refunds;</li><li>prevent fraud and misuse;</li><li>provide customer support;</li><li>improve the service;</li><li>maintain technical and security functions;</li><li>comply with legal obligations.</li></ul><p>The legal basis for each processing activity will be specified in the final legally reviewed Privacy Policy.</p>
<h4>4. Grocery and Order Data</h4><p>Großry processes information about selected products and orders in order to aggregate demand and arrange collective procurement. Aggregated purchasing information may also be used to understand product demand and improve procurement.</p>
<h4>5. Data Shared With Third Parties</h4><p>Personal data may be shared with service providers where necessary to operate Großry, such as:</p><ul><li>payment providers;</li><li>hosting and IT providers;</li><li>logistics providers;</li><li>participating suppliers;</li><li>customer-support providers.</li></ul><p>Großry will not disclose more information than is reasonably necessary for the relevant purpose.</p>
<h4>6. Aggregated and Anonymous Information</h4><p>Großry may create statistical information from purchasing activity, for example: number of students participating; total quantities purchased; aggregate product demand; overall purchasing trends.</p><p>Where Großry describes information as anonymous, the information should be processed so that individual users are no longer identifiable. Pseudonymised or merely de-identified information should not automatically be treated as anonymous. Under EU data-protection guidance, information that can still be linked to an identifiable person remains personal data.</p>
<h4>7. Commercial Use of Aggregated Information</h4><p>Großry may provide appropriately aggregated and genuinely anonymised market statistics to suppliers, research partners or other commercial partners. Großry will not intentionally sell identifiable individual purchasing profiles as anonymous information.</p>
<h4>8. Data Retention</h4><p>Personal data will be retained only for as long as reasonably necessary for the purposes for which it was collected, unless a longer period is required by law. Specific retention periods should be defined for: account data; transaction records; customer-support records; forum content; security logs.</p>
<h4>9. User Rights</h4><p>Subject to applicable law, users may have rights including:</p><ul><li>access to their personal data;</li><li>correction of inaccurate data;</li><li>deletion;</li><li>restriction of processing;</li><li>objection to certain processing;</li><li>data portability;</li><li>withdrawal of consent where processing is based on consent.</li></ul><p>Users also have the right to lodge a complaint with the competent supervisory authority.</p>
<h4>10. Data Security</h4><p>Großry will implement appropriate technical and organisational security measures to protect personal data against unauthorised access, alteration, loss or disclosure.</p>
<h4>11. Profile Photograph</h4><p>If a profile photograph is collected, Großry will explain the purpose for which it is required and who may access it. If a photograph is not necessary for the service, Großry should consider making it optional or removing it from registration.</p>
<h4>12. Payments</h4><p>Payment card information should preferably be processed directly by an appropriately qualified payment provider rather than stored unnecessarily by Großry.</p>
<h4>13. Cookies and Analytics</h4><p>The final Privacy Policy will describe any cookies, analytics tools, advertising technologies or similar technologies used by Großry. Where consent is legally required, the relevant consent mechanism will be provided.</p>
<p class="small mute">This prototype itself uses no cookies or analytics. It keeps its demo state in your browser's local storage only, and <b>Reset demo</b> clears it.</p>
<h4>14. Changes to This Policy</h4><p>Großry may update this Privacy Policy when its services, processing activities or legal obligations change. Material changes will be communicated through an appropriate channel.</p>
<h4>15. Contact</h4><p>Großry, [Legal entity name], [Address], [Privacy email]. Where applicable: Data Protection Officer: [Contact details].</p>`;

  return { products, reviews, requests, forum, history, universities, terms, privacy };
})();
