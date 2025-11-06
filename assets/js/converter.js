// ==UserScript==
// @name        JB_Script_converter
// @namespace   Violentmonkey Scripts
// @match       *://*/*
// @grant       none
// @version     1.0
// @author      Jovial Badger
// @description 2025-10-01
// ==/UserScript==
/**
 * UnitConverter(options)
 *
 * Single-file, no-dependency unit conversion system.
 *
 * Usage:
 *  - Create UI in page:
 *      const vc = UnitConverter(); // injects DOM & returns API
 *
 *  - Use programmatically (no DOM):
 *      const api = UnitConverter({ dom: false });
 *      api.getUnits('Lengths'); // -> array of units
 *      api.convert('Lengths', 'Meter', 10); // -> { unit: 'Meter', value: 10, conversions: [...] }
 *
 * Options:
 *  - dom: boolean (default true) - whether to inject UI/DOM
 *  - containerId: string optional - id for root container element
 *  - initial: { type, sigfigs, decimals, pinnedFrom, pinnedTo } optional
 *
 * Returns: API object with methods:
 *   - getUnits(type)
 *   - getUnit(type, unitName)
 *   - convert(type, unitName, value, { sigfigs, decimals })
 *   - setSettings(settings)
 *   - focusUnits(fromUnit, toUnit)
 *   - getState()
 *   - destroy()
 *
 * Notes:
 *  - SI units are highlighted in the UI.
 *  - URL query updated to reflect current type/sigfigs/decimals/last.
 *  - Copy-to-clipboard supported via navigator.clipboard, with fallback.
 */
function UnitConverter(options = {}) {
  // --- configuration / defaults
  const config = {
    dom: options.dom !== undefined ? options.dom : true,
    containerId: options.containerId || 'unit-converter-root',
    initial: options.initial || {},
  };

  // --- helpers
  const qs = (s, ctx = document) => ctx.querySelector(s);
  const qsa = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));
  const isNumber = (v) => typeof v === 'number' && !isNaN(v);
  const safeNumber = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };
  const clampInt = (v, min, max) => Math.max(min, Math.min(max, parseInt(v) || min));

  // formatting: decimals overrides sigfigs when provided explicitly
  function formatValue(val, sigfigs = null, decimals = null) {
    if (val === null || !isFinite(val)) return '';
    if (decimals !== null && decimals !== undefined) {
      return Number(val).toFixed(decimals);
    }
    if (sigfigs !== null && sigfigs !== undefined) {
      // toPrecision returns string — convert to string but remove trailing zeros only when not scientific
      return Number(val).toPrecision(sigfigs);
    }
    return String(val);
  }

  // clipboard
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(String(text));
        return true;
      } else {
        const ta = document.createElement('textarea');
        ta.value = String(text);
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      }
    } catch (e) {
      return false;
    }
  }

  // --- unit definitions
  // Each unit entry:
  // {
  //   type: 'Lengths',
  //   name: 'Meter',
  //   symbol: 'm',
  //   isSI: true/false,
  //   toSI: function(v) => value in SI,
  //   fromSI: function(si) => value in this unit
  // }
  // This design supports offsets (temp) and complex conversions cleanly.
  const Units = (function buildUnits() {
    const u = [];

    // helper factory for linear scaling: multiplier where SI = value * multiplier
    const linear = (mult, name, symbol, isSI = false) => ({
      toSI: (v) => v * mult,
      fromSI: (si) => si / mult,
      name,
      symbol,
      isSI,
    });
    function linearFromArray(array,type){
      array.forEach(x => {u.push({ type: type, ...linear(1/x.multi, x.name, x.symbol,x.isSI || false) });})
    }

    // Temperatures (use Kelvin as SI)
    u.push({
      type: 'Temperatures',
      name: 'Kelvin',
      symbol: 'K',
      isSI: true,
      toSI: (v) => v,
      fromSI: (si) => si,
    });
    u.push({
      type: 'Temperatures',
      name: 'Celsius',
      symbol: '°C',
      isSI: false,
      toSI: (v) => v + 273.15,
      fromSI: (si) => si - 273.15,
    });
    u.push({
      type: 'Temperatures',
      name: 'Fahrenheit',
      symbol: '°F',
      isSI: false,
      toSI: (v) => (v - 32) * (5 / 9) + 273.15,
      fromSI: (si) => (si - 273.15) * (9 / 5) + 32,
    });
    u.push({
      type: 'Temperatures',
      name: 'rankine',
      symbol: '°R',
      isSI: false,
      toSI: (v) => v * 5/9,
      fromSI: (si) => si / (5/9),
    });
    u.push({
      type: 'Temperatures',
      name: 'reaumur',
      symbol: '°Ré',
      isSI: false,
      toSI: (v) => (v * 5/4) + 273.15,
      fromSI: (si) => (si - 273.15) / (5/4),
    });

    // Time (SI second)
const _times = [
  {"name":"second","symbol":"s","multi":1, isSI: true},

  // SI submultiples
  {"name":"millisecond","symbol":"ms","multi":1000},
  {"name":"microsecond","symbol":"µs","multi":1e6},
  {"name":"nanosecond","symbol":"ns","multi":1e9},
  {"name":"picosecond","symbol":"ps","multi":1e12},
  {"name":"femtosecond","symbol":"fs","multi":1e15},
  {"name":"attosecond","symbol":"as","multi":1e18},
  {"name":"zeptosecond","symbol":"zs","multi":1e21},
  {"name":"yoctosecond","symbol":"ys","multi":1e24},

  // SI multiples
  {"name":"minute","symbol":"min","multi":1/60},
  {"name":"hour","symbol":"h","multi":1/3600},
  {"name":"day (mean solar)","symbol":"d","multi":1/86400},
  {"name":"week","symbol":"wk","multi":1/604800},
  {"name":"fortnight","symbol":"","multi":1/1209600},

  // Calendar / civil
  {"name":"month (30 d)","symbol":"mo","multi":1/2592000},
  {"name":"year (Julian, 365.25 d)","symbol":"a","multi":1/31557600},
  {"name":"decade","symbol":"","multi":1/315576000},
  {"name":"century","symbol":"","multi":1/3155760000},
  {"name":"millennium","symbol":"","multi":1/31557600000},

  // Astronomical / natural
  {"name":"sidereal day","symbol":"","multi":1/86164.0905},
  {"name":"sidereal year","symbol":"","multi":1/31558149.54},
  {"name":"tropical year","symbol":"","multi":1/31556925.22},
  {"name":"lunar month (synodic)","symbol":"","multi":1/2551442.89},

  // Physical constants
  {"name":"Planck time","symbol":"tP","multi":1.855094832e43}, // 1 s ≈ 1.85×10^43 Planck times
  {"name":"shake (10 ns)","symbol":"","multi":1e8}, // nuclear physics unit
  {"name":"jiffy (physics, 1/60 s)","symbol":"","multi":60}, // common in electronics
  {"name":"jiffy (CS, 1/100 s)","symbol":"","multi":100},

  // Historical / cultural
  {"name":"moment (medieval, 90 s)","symbol":"","multi":1/90},
  {"name":"watch (medieval, 3 h)","symbol":"","multi":1/10800}
];
    linearFromArray(_times, 'Time');

    // Lengths (SI meter)
const _lengths = [
  {"name":"meter","symbol":"m","multi":1, isSI: true},

  // SI submultiples
  {"name":"decimeter","symbol":"dm","multi":10},
  {"name":"centimeter","symbol":"cm","multi":100},
  {"name":"millimeter","symbol":"mm","multi":1000},
  {"name":"micrometer","symbol":"µm","multi":1e6},
  {"name":"nanometer","symbol":"nm","multi":1e9},
  {"name":"picometer","symbol":"pm","multi":1e12},
  {"name":"femtometer (fermi)","symbol":"fm","multi":1e15},
  {"name":"attometer","symbol":"am","multi":1e18},
  {"name":"zeptometer","symbol":"zm","multi":1e21},
  {"name":"yoctometer","symbol":"ym","multi":1e24},

  // SI multiples
  {"name":"dekameter","symbol":"dam","multi":0.1},
  {"name":"hectometer","symbol":"hm","multi":0.01},
  {"name":"kilometer","symbol":"km","multi":0.001},
  {"name":"megameter","symbol":"Mm","multi":1e-6},
  {"name":"gigameter","symbol":"Gm","multi":1e-9},
  {"name":"terameter","symbol":"Tm","multi":1e-12},
  {"name":"petameter","symbol":"Pm","multi":1e-15},
  {"name":"exameter","symbol":"Em","multi":1e-18},

  // Imperial / US customary
  {"name":"inch","symbol":"in","multi":39.37007874},
  {"name":"foot","symbol":"ft","multi":3.280839895},
  {"name":"yard","symbol":"yd","multi":1.093613298},
  {"name":"mile (statute)","symbol":"mi","multi":0.0006213712},
  {"name":"furlong","symbol":"fur","multi":0.0049709695},
  {"name":"rod (perch/pole)","symbol":"rd","multi":0.1988387815},
  {"name":"chain (Gunter’s)","symbol":"ch","multi":0.0497096954},
  {"name":"link (Gunter’s)","symbol":"li","multi":4.9709695379},
  {"name":"survey foot (US)","symbol":"ft (US)","multi":3.2808333333},
  {"name":"survey mile (US)","symbol":"mi (US)","multi":0.0006213699},

  // Nautical
  {"name":"nautical mile (international)","symbol":"nmi","multi":0.0005399568},
  {"name":"fathom","symbol":"ftm","multi":0.5468066492},
  {"name":"cable","symbol":"cb","multi":0.0049342105},

  // Astronomical
  {"name":"astronomical unit","symbol":"AU","multi":6.684587122e-12},
  {"name":"light-year","symbol":"ly","multi":1.057000834e-16},
  {"name":"parsec","symbol":"pc","multi":3.240779289e-17},
  {"name":"kiloparsec","symbol":"kpc","multi":3.240779289e-20},
  {"name":"megaparsec","symbol":"Mpc","multi":3.240779289e-23},

  // Particle / natural units
  {"name":"ångström","symbol":"Å","multi":1e10},
  {"name":"Bohr radius","symbol":"a₀","multi":1.889726125e10},
  {"name":"Planck length","symbol":"ℓP","multi":6.187927353e34},

  // Historical / cultural
  {"name":"cubit (Biblical)","symbol":"","multi":2.187226596}, // ~18 in
  {"name":"span","symbol":"","multi":4.374453193}, // ~9 in
  {"name":"hand","symbol":"h","multi":9.842519685}, // 4 in
  {"name":"ell (English)","symbol":"","multi":0.874890638}, // 45 in
  {"name":"league (English)","symbol":"","multi":0.0002071237}, // 3 miles
  {"name":"Roman mile (mille passus)","symbol":"","multi":0.0006818182}, // ~1480 m
  {"name":"Roman foot (pes)","symbol":"","multi":3.378378378}
];
    linearFromArray(_lengths, 'Lengths');

const _weights = [
  {"name":"kilogram","symbol":"kg","multi":1, isSI: true},

  // Metric multiples
  {"name":"gram","symbol":"g","multi":1000},
  {"name":"milligram","symbol":"mg","multi":1000000},
  {"name":"microgram","symbol":"µg","multi":1000000000},
  {"name":"nanogram","symbol":"ng","multi":1e12},
  {"name":"picogram","symbol":"pg","multi":1e15},
  {"name":"femtogram","symbol":"fg","multi":1e18},
  {"name":"attogram","symbol":"ag","multi":1e21},
  {"name":"centigram","symbol":"cg","multi":100000},
  {"name":"decigram","symbol":"dg","multi":10000},
  {"name":"dekagram","symbol":"dag","multi":100},
  {"name":"hectogram","symbol":"hg","multi":10},

  // Large metric units
  {"name":"megagram (tonne)","symbol":"Mg","multi":0.001},
  {"name":"gigagram","symbol":"Gg","multi":1e-6},
  {"name":"teragram","symbol":"Tg","multi":1e-9},
  {"name":"petagram","symbol":"Pg","multi":1e-12},
  {"name":"exagram","symbol":"Eg","multi":1e-15},
  {"name":"kiloton (metric)","symbol":"kt","multi":1e-6},
  {"name":"quintal (metric)","symbol":"q","multi":0.01},

  // Imperial / US customary
  {"name":"pound","symbol":"lb","multi":2.2046226218},
  {"name":"ounce","symbol":"oz","multi":35.27396195},
  {"name":"short ton (US)","symbol":"ton (US)","multi":0.0011023113},
  {"name":"long ton (UK)","symbol":"ton (UK)","multi":0.0009842065},
  {"name":"hundredweight (US)","symbol":"cwt (US)","multi":0.0220462262},
  {"name":"hundredweight (UK)","symbol":"cwt (UK)","multi":0.0196841306},
  {"name":"quarter (US)","symbol":"qr (US)","multi":0.0881849049},
  {"name":"quarter (UK)","symbol":"qr (UK)","multi":0.0787365222},
  {"name":"stone (UK)","symbol":"st (UK)","multi":0.1574730444},
  {"name":"kilopound","symbol":"kip","multi":0.0022046226},
  {"name":"slug","symbol":"slug","multi":0.0685217659},

  // Troy / apothecary
  {"name":"carat","symbol":"ct","multi":5000},
  {"name":"pennyweight","symbol":"dwt","multi":643.01493137},
  {"name":"scruple (apothecary)","symbol":"s.ap","multi":771.61791764},
  {"name":"grain","symbol":"gr","multi":15432.358353},
  {"name":"pound (troy)","symbol":"lb t","multi":2.6792288807},

  // Assay tons
  {"name":"assay ton (US)","symbol":"AT (US)","multi":34.285710367},
  {"name":"assay ton (UK)","symbol":"AT (UK)","multi":30.612244898},

  // Atomic / particle units
  {"name":"atomic mass unit","symbol":"u","multi":6.02e26},
  {"name":"dalton","symbol":"Da","multi":6.02e26},

  // Natural / fundamental constants
  {"name":"Planck mass","symbol":"mP","multi":45940892.448},
  {"name":"electron mass (rest)","symbol":"me","multi":1.10e30},
  {"name":"muon mass","symbol":"mμ","multi":5.31e27},
  {"name":"proton mass","symbol":"mp","multi":5.98e26},
  {"name":"neutron mass","symbol":"mn","multi":5.97e26},
  {"name":"deuteron mass","symbol":"md","multi":2.99e26},

  // Astronomical
  {"name":"Earth mass","symbol":"M⊕","multi":1.67e-25},
  {"name":"Solar mass","symbol":"M☉","multi":5.03e-31},

  // Historical / biblical (kept as-is, internally consistent)
  {"name":"talent (Hebrew)","symbol":"","multi":0.0292397661},
  {"name":"mina (Hebrew)","symbol":"","multi":1.7543859649},
  {"name":"shekel (Hebrew)","symbol":"","multi":87.719298246},
  {"name":"bekan (Hebrew)","symbol":"","multi":175.43859649},
  {"name":"gerah (Hebrew)","symbol":"","multi":1754.3859649},
  {"name":"talent (Greek)","symbol":"","multi":0.0490196078},
  {"name":"mina (Greek)","symbol":"","multi":2.9411764706},
  {"name":"tetradrachma (Greek)","symbol":"","multi":73.529411765},
  {"name":"didrachma (Greek)","symbol":"","multi":147.05882353},
  {"name":"drachma (Greek)","symbol":"","multi":294.11764706},
  {"name":"denarius (Roman)","symbol":"","multi":259.74025974},
  {"name":"assarion (Roman)","symbol":"","multi":4155.8441558},
  {"name":"quadrans (Roman)","symbol":"","multi":16623.376623},
  {"name":"lepton (Roman)","symbol":"","multi":33246.753247}
];
    linearFromArray(_weights, 'Weights');

    // Volumes (SI cubic metre m^3) - define common ones
const _volumes = [
  {"name":"cubic meter","symbol":"m³","multi":1, isSI: true},

  // SI submultiples
  {"name":"cubic decimeter (liter)","symbol":"dm³ / L","multi":1000},
  {"name":"milliliter","symbol":"mL","multi":1e6},
  {"name":"microliter","symbol":"µL","multi":1e9},
  {"name":"nanoliter","symbol":"nL","multi":1e12},
  {"name":"picoliter","symbol":"pL","multi":1e15},
  {"name":"femtoliter","symbol":"fL","multi":1e18},
  {"name":"attoliter","symbol":"aL","multi":1e21},

  // SI multiples
  {"name":"cubic centimeter","symbol":"cm³ / cc","multi":1e6},
  {"name":"cubic millimeter","symbol":"mm³","multi":1e9},
  {"name":"cubic kilometer","symbol":"km³","multi":1e-9},
  {"name":"megaliter","symbol":"ML","multi":1000},
  {"name":"gigaliter","symbol":"GL","multi":1e6},
  {"name":"teraliter","symbol":"TL","multi":1e9},

  // Imperial / US customary
  {"name":"cubic inch","symbol":"in³","multi":61023.7441},
  {"name":"cubic foot","symbol":"ft³","multi":35.31466672},
  {"name":"cubic yard","symbol":"yd³","multi":1.307950619},
  {"name":"US gallon (liquid)","symbol":"gal (US)","multi":264.1720524},
  {"name":"US quart","symbol":"qt (US)","multi":1056.688209},
  {"name":"US pint","symbol":"pt (US)","multi":2113.376419},
  {"name":"US cup","symbol":"cup (US)","multi":4226.752838},
  {"name":"US fluid ounce","symbol":"fl oz (US)","multi":33814.0227},
  {"name":"US tablespoon","symbol":"tbsp (US)","multi":67628.0454},
  {"name":"US teaspoon","symbol":"tsp (US)","multi":202884.1362},

  {"name":"Imperial gallon","symbol":"gal (UK)","multi":219.9692483},
  {"name":"Imperial quart","symbol":"qt (UK)","multi":879.8769932},
  {"name":"Imperial pint","symbol":"pt (UK)","multi":1759.753986},
  {"name":"Imperial cup","symbol":"cup (UK)","multi":3519.507972},
  {"name":"Imperial fluid ounce","symbol":"fl oz (UK)","multi":35195.07972},
  {"name":"Imperial tablespoon","symbol":"tbsp (UK)","multi":56312.12755},
  {"name":"Imperial teaspoon","symbol":"tsp (UK)","multi":168936.3826},

  // Nautical / shipping
  {"name":"register ton (shipping)","symbol":"RT","multi":0.353146667}, // 100 ft³
  {"name":"board foot","symbol":"FBM","multi":423.776001}, // 144 in³

  // Cooking (metric)
  {"name":"tablespoon (metric)","symbol":"tbsp","multi":66666.6667}, // 15 mL
  {"name":"teaspoon (metric)","symbol":"tsp","multi":200000}, // 5 mL

  // Historical / cultural
  {"name":"amphora (Roman)","symbol":"","multi":1306.290}, // ~26.2 L
  {"name":"hogshead (wine, UK)","symbol":"","multi":6.110256}, // ~238.7 L
  {"name":"butt (wine, UK)","symbol":"","multi":3.055128}, // ~477.4 L
  {"name":"tun (wine, UK)","symbol":"","multi":1.527564}, // ~954.8 L

  // Astronomical / natural
  {"name":"cubic light-year","symbol":"ly³","multi":1.18e-50},
  {"name":"cubic astronomical unit","symbol":"AU³","multi":2.37e-34}
];
    linearFromArray(_volumes, 'Volumes');

    // Areas (m^2)
const _areas = [
  {"name":"square meter","symbol":"m²","multi":1, isSI: true},

  // SI submultiples
  {"name":"square decimeter","symbol":"dm²","multi":100},
  {"name":"square centimeter","symbol":"cm²","multi":10000},
  {"name":"square millimeter","symbol":"mm²","multi":1e6},
  {"name":"square micrometer","symbol":"µm²","multi":1e12},
  {"name":"square nanometer","symbol":"nm²","multi":1e18},
  {"name":"square picometer","symbol":"pm²","multi":1e24},

  // SI multiples
  {"name":"square decameter (are)","symbol":"dam² / a","multi":0.01}, // 1 are = 100 m²
  {"name":"hectare","symbol":"ha","multi":0.0001}, // 1 ha = 10,000 m²
  {"name":"square kilometer","symbol":"km²","multi":1e-6},
  {"name":"square megameter","symbol":"Mm²","multi":1e-12},

  // Imperial / US customary
  {"name":"square inch","symbol":"in²","multi":1550.0031},
  {"name":"square foot","symbol":"ft²","multi":10.76391042},
  {"name":"square yard","symbol":"yd²","multi":1.195990046},
  {"name":"square mile","symbol":"mi²","multi":3.861021585e-7},
  {"name":"acre (international)","symbol":"ac","multi":0.0002471054},
  {"name":"rood","symbol":"ro","multi":0.0009884216}, // 1/4 acre
  {"name":"perch (rod²)","symbol":"perch","multi":0.039536861}, // 1 rod² = 25.2929 m²

  // Surveyor’s
  {"name":"square rod (pole/perch)","symbol":"rd²","multi":0.039536861},
  {"name":"square chain","symbol":"ch²","multi":0.0002471054}, // 1 chain² = 4356 ft² = 404.6856 m²
  {"name":"section (US survey)","symbol":"section","multi":3.861021585e-7}, // 1 mi²
  {"name":"township (US survey)","symbol":"twp","multi":1.072506e-8}, // 36 mi²

  // Agricultural / practical
  {"name":"barn","symbol":"b","multi":1e28}, // nuclear physics, 1e-28 m²
  {"name":"square rod (UK)","symbol":"sq rd","multi":0.039536861},
  {"name":"square perch (UK)","symbol":"sq perch","multi":0.039536861},

  // Astronomical / natural
  {"name":"square astronomical unit","symbol":"AU²","multi":4.4683705e-23},
  {"name":"square light-year","symbol":"ly²","multi":1.1172506e-33},
  {"name":"square parsec","symbol":"pc²","multi":1.050265e-34},

  // Historical / cultural
  {"name":"dunam (Middle Eastern)","symbol":"dunam","multi":0.0001}, // ~1000 m²
  {"name":"stremma (Greek)","symbol":"stremma","multi":0.0001}, // 1000 m²
  {"name":"jerib (Persian)","symbol":"jerib","multi":0.0002}, // ~2000 m²
  {"name":"cuerda (Puerto Rico)","symbol":"cda","multi":0.0003930148} // ~3930 m²
];
    linearFromArray(_areas, 'Areas');

    // Speeds (m/s)
const _speeds = [
  {"name":"meter per second","symbol":"m/s","multi":1, isSI: true},

  // SI multiples
  {"name":"kilometer per second","symbol":"km/s","multi":0.001},
  {"name":"kilometer per hour","symbol":"km/h","multi":3.6},
  {"name":"centimeter per second","symbol":"cm/s","multi":100},
  {"name":"millimeter per second","symbol":"mm/s","multi":1000},
  {"name":"micrometer per second","symbol":"µm/s","multi":1e6},

  // Imperial / US customary
  {"name":"foot per second","symbol":"ft/s","multi":3.280839895},
  {"name":"foot per minute","symbol":"ft/min","multi":196.850394},
  {"name":"mile per hour","symbol":"mph","multi":2.236936292},
  {"name":"mile per second","symbol":"mi/s","multi":0.0006213712},
  {"name":"inch per second","symbol":"in/s","multi":39.37007874},

  // Nautical
  {"name":"knot (nautical mile per hour)","symbol":"kn","multi":1.943844492},
  {"name":"nautical mile per second","symbol":"nmi/s","multi":0.0005399568},

  // Astronomical / physical constants
  {"name":"speed of light in vacuum","symbol":"c","multi":3.335640952e-9}, // 1 m/s = 3.34e-9 c
  {"name":"speed of sound (Mach 1, sea level, 20°C)","symbol":"Mach","multi":0.00293866996}, // 1 m/s ≈ 0.00294 Mach
  {"name":"Earth escape velocity","symbol":"ve","multi":0.0001256}, // 1 m/s ≈ 1.26e-4 of escape velocity
  {"name":"Earth orbital velocity (mean)","symbol":"vorb","multi":0.0000336}, // 1 m/s ≈ 3.36e-5 of orbital velocity

  // Historical / cultural
  {"name":"pace per second (Roman)","symbol":"","multi":0.6666667}, // 1 pace ≈ 1.48 m
  {"name":"league per hour (English)","symbol":"","multi":0.0007462687} // 1 league ≈ 3 miles
];
    linearFromArray(_speeds, 'Speeds');

    // Energy / Work (Joule)
const _energies = [
  {"name":"joule","symbol":"J","multi":1, isSI: true},

  // SI multiples
  {"name":"kilojoule","symbol":"kJ","multi":0.001},
  {"name":"megajoule","symbol":"MJ","multi":1e-6},
  {"name":"gigajoule","symbol":"GJ","multi":1e-9},
  {"name":"terajoule","symbol":"TJ","multi":1e-12},
  {"name":"petajoule","symbol":"PJ","multi":1e-15},
  {"name":"exajoule","symbol":"EJ","multi":1e-18},

  // SI submultiples
  {"name":"millijoule","symbol":"mJ","multi":1000},
  {"name":"microjoule","symbol":"µJ","multi":1e6},
  {"name":"nanojoule","symbol":"nJ","multi":1e9},
  {"name":"picojoule","symbol":"pJ","multi":1e12},
  {"name":"femtojoule","symbol":"fJ","multi":1e15},
  {"name":"attojoule","symbol":"aJ","multi":1e18},

  // Calories
  {"name":"calorie (thermochemical)","symbol":"cal","multi":0.2390057361},
  {"name":"kilocalorie (food calorie)","symbol":"kcal","multi":0.0002390057},
  {"name":"calorie (IT)","symbol":"cal_IT","multi":0.2388458966},

  // Electronvolt
  {"name":"electronvolt","symbol":"eV","multi":6.241509074e18},
  {"name":"kiloelectronvolt","symbol":"keV","multi":6.241509074e15},
  {"name":"megaelectronvolt","symbol":"MeV","multi":6.241509074e12},
  {"name":"gigaelectronvolt","symbol":"GeV","multi":6.241509074e9},
  {"name":"teraelectronvolt","symbol":"TeV","multi":6.241509074e6},

  // British thermal units
  {"name":"BTU (IT)","symbol":"BTU","multi":0.0009478171},
  {"name":"BTU (thermochemical)","symbol":"BTU_th","multi":0.0009484514},

  // Power industry
  {"name":"watt-hour","symbol":"Wh","multi":0.0002777778},
  {"name":"kilowatt-hour","symbol":"kWh","multi":2.7777778e-7},
  {"name":"megawatt-hour","symbol":"MWh","multi":2.7777778e-10},

  // Heat content / fuels
  {"name":"therm (US)","symbol":"thm","multi":9.4781712e-9},
  {"name":"therm (UK)","symbol":"thm (UK)","multi":9.4781712e-9}, // nearly same
  {"name":"ton of TNT","symbol":"tTNT","multi":2.390057361e-10}, // 1 t TNT = 4.184e9 J

  // Natural / physical constants
  {"name":"Planck energy","symbol":"Ep","multi":6.241509074e9}, // ~1.956e9 J
  {"name":"Hartree energy","symbol":"Eh","multi":2.293712278e17}, // ~4.3597e-18 J
  {"name":"Rydberg energy","symbol":"Ry","multi":1.146856139e17}, // ~2.1799e-18 J

  // Historical / cultural
  {"name":"erg","symbol":"erg","multi":1e7}, // 1 erg = 1e-7 J
  {"name":"foot-pound force","symbol":"ft·lbf","multi":0.7375621493},
  {"name":"inch-pound force","symbol":"in·lbf","multi":8.850745791}
];
    linearFromArray(_energies, 'Energy / Work');

    // Power (Watt)
const _powers = [
  {"name":"watt","symbol":"W","multi":1, isSI: true},

  // SI multiples
  {"name":"kilowatt","symbol":"kW","multi":0.001},
  {"name":"megawatt","symbol":"MW","multi":1e-6},
  {"name":"gigawatt","symbol":"GW","multi":1e-9},
  {"name":"terawatt","symbol":"TW","multi":1e-12},
  {"name":"petawatt","symbol":"PW","multi":1e-15},
  {"name":"exawatt","symbol":"EW","multi":1e-18},

  // SI submultiples
  {"name":"milliwatt","symbol":"mW","multi":1000},
  {"name":"microwatt","symbol":"µW","multi":1e6},
  {"name":"nanowatt","symbol":"nW","multi":1e9},
  {"name":"picowatt","symbol":"pW","multi":1e12},
  {"name":"femtowatt","symbol":"fW","multi":1e15},
  {"name":"attowatt","symbol":"aW","multi":1e18},

  // Horsepower variants
  {"name":"horsepower (mechanical)","symbol":"hp","multi":0.0013410221}, // 745.7 W
  {"name":"horsepower (metric)","symbol":"hp(M)","multi":0.0013596216}, // 735.5 W
  {"name":"horsepower (electrical)","symbol":"hp(E)","multi":0.0013404826},
  {"name":"boiler horsepower","symbol":"hp(boiler)","multi":0.000101941}, // 9.81 kW

  // Heat / refrigeration
  {"name":"BTU per hour","symbol":"BTU/h","multi":3.412141633},
  {"name":"BTU per minute","symbol":"BTU/min","multi":0.0568690272},
  {"name":"BTU per second","symbol":"BTU/s","multi":0.0009478171},
  {"name":"ton of refrigeration","symbol":"TR","multi":0.0002843451}, // 3.517 kW

  // Electrical
  {"name":"volt-ampere","symbol":"VA","multi":1}, // apparent power
  {"name":"kilovolt-ampere","symbol":"kVA","multi":0.001},
  {"name":"megavolt-ampere","symbol":"MVA","multi":1e-6},

  // Natural / physical constants
  {"name":"solar luminosity","symbol":"L☉","multi":2.613e-27}, // 3.828e26 W
  {"name":"Planck power","symbol":"Pp","multi":1.85e-44} // ~3.63e52 W
];
    linearFromArray(_powers, 'Power');

    // Force (Newton)
const _forces = [
  {"name":"newton","symbol":"N","multi":1, isSI: true},

  // SI multiples
  {"name":"kilonewton","symbol":"kN","multi":0.001},
  {"name":"meganewton","symbol":"MN","multi":1e-6},
  {"name":"giganewton","symbol":"GN","multi":1e-9},
  {"name":"teranewton","symbol":"TN","multi":1e-12},

  // SI submultiples
  {"name":"millinewton","symbol":"mN","multi":1000},
  {"name":"micronewton","symbol":"µN","multi":1e6},
  {"name":"nanonewton","symbol":"nN","multi":1e9},
  {"name":"piconewton","symbol":"pN","multi":1e12},
  {"name":"femtonewton","symbol":"fN","multi":1e15},

  // CGS
  {"name":"dyne","symbol":"dyn","multi":1e5}, // 1 N = 1e5 dynes

  // Gravitational units
  {"name":"kilogram-force","symbol":"kgf","multi":0.1019716213}, // 1 kgf = 9.80665 N
  {"name":"gram-force","symbol":"gf","multi":101.9716213},
  {"name":"ton-force (metric)","symbol":"tf","multi":0.0001019716},

  // Imperial / US customary
  {"name":"pound-force","symbol":"lbf","multi":0.2248089431},
  {"name":"ounce-force","symbol":"ozf","multi":3.5969430896},
  {"name":"kip (kilopound-force)","symbol":"kipf","multi":0.0002248089},
  {"name":"ton-force (US short)","symbol":"tonf (US)","multi":0.0001124045},
  {"name":"ton-force (UK long)","symbol":"tonf (UK)","multi":0.0001003611},
  {"name":"poundal","symbol":"pdl","multi":7.233013851}, // 1 N = 7.233 pdl

  // Natural / physical constants
  {"name":"Planck force","symbol":"Fp","multi":7.42e-45}, // ~1.21e44 N
  {"name":"kilogram-weight","symbol":"kgw","multi":0.1019716213} // synonym for kgf
];
    linearFromArray(_forces, 'Force');

    // Pressure (Pascal)
const _pressures = [
  {"name":"pascal","symbol":"Pa","multi":1, isSI: true},

  // SI multiples
  {"name":"kilopascal","symbol":"kPa","multi":0.001},
  {"name":"megapascal","symbol":"MPa","multi":1e-6},
  {"name":"gigapascal","symbol":"GPa","multi":1e-9},
  {"name":"terapascal","symbol":"TPa","multi":1e-12},

  // SI submultiples
  {"name":"hectopascal","symbol":"hPa","multi":0.01}, // meteorology
  {"name":"millipascal","symbol":"mPa","multi":1000},
  {"name":"micropascal","symbol":"µPa","multi":1e6},
  {"name":"nanopascal","symbol":"nPa","multi":1e9},

  // Common non-SI
  {"name":"bar","symbol":"bar","multi":1e-5}, // 1 bar = 1e5 Pa
  {"name":"millibar","symbol":"mbar","multi":0.01}, // 1 mbar = 100 Pa
  {"name":"atmosphere (standard)","symbol":"atm","multi":9.869232667e-6}, // 101325 Pa
  {"name":"technical atmosphere","symbol":"at","multi":1.019716213e-5}, // 1 kgf/cm² = 98,066.5 Pa
  {"name":"torr","symbol":"Torr","multi":0.0075006168}, // 1 Torr = 133.322 Pa
  {"name":"millimeter of mercury","symbol":"mmHg","multi":0.0075006168}, // same as Torr
  {"name":"inch of mercury","symbol":"inHg","multi":0.0002952999}, // 3386.389 Pa
  {"name":"inch of water (4°C)","symbol":"inH₂O","multi":0.00401865}, // 249.0889 Pa
  {"name":"centimeter of water (4°C)","symbol":"cmH₂O","multi":0.0101971621}, // 98.0665 Pa
  {"name":"millimeter of water (4°C)","symbol":"mmH₂O","multi":1.019716213}, // 9.80665 Pa

  // Imperial / US customary
  {"name":"pound per square inch","symbol":"psi","multi":0.0001450377},
  {"name":"pound per square foot","symbol":"psf","multi":0.0208854342},

  // Energy density equivalence
  {"name":"joule per cubic meter","symbol":"J/m³","multi":1}, // identical to Pa

  // Natural / physical constants
  {"name":"Planck pressure","symbol":"Pp","multi":4.8e-114}, // ~4.63e113 Pa
];
    linearFromArray(_pressures, 'Pressure');

    // Frequency
const _frequencies = [
  {"name":"hertz","symbol":"Hz","multi":1, isSI: true},

  // SI multiples
  {"name":"kilohertz","symbol":"kHz","multi":0.001},
  {"name":"megahertz","symbol":"MHz","multi":1e-6},
  {"name":"gigahertz","symbol":"GHz","multi":1e-9},
  {"name":"terahertz","symbol":"THz","multi":1e-12},
  {"name":"petahertz","symbol":"PHz","multi":1e-15},
  {"name":"exahertz","symbol":"EHz","multi":1e-18},

  // SI submultiples
  {"name":"millihertz","symbol":"mHz","multi":1000},
  {"name":"microhertz","symbol":"µHz","multi":1e6},
  {"name":"nanohertz","symbol":"nHz","multi":1e9},
  {"name":"picohertz","symbol":"pHz","multi":1e12},
  {"name":"femtohertz","symbol":"fHz","multi":1e15},
  {"name":"attohertz","symbol":"aHz","multi":1e18},

  // Angular frequency
  {"name":"radian per second","symbol":"rad/s","multi":6.283185307},
  // since 1 Hz = 2π rad/s, so 1 rad/s = 1/(2π) Hz → 1 Hz = 2π rad/s

  // Time-based equivalents
  {"name":"cycle per minute (cpm)","symbol":"cpm","multi":60},
  {"name":"cycle per hour","symbol":"cph","multi":3600},
  {"name":"revolutions per minute","symbol":"rpm","multi":60},
  {"name":"revolutions per second","symbol":"rps","multi":1},

  // Astronomical / geophysical
  {"name":"sidereal day⁻¹","symbol":"d⁻¹","multi":86400}, // 1/day
  {"name":"sidereal year⁻¹","symbol":"a⁻¹","multi":3.15576e7}, // 1/year

  // Natural / physical constants
  {"name":"Planck frequency","symbol":"fp","multi":1.8549e43}, // 1 Hz ≈ 1.85e43 Planck freq
  {"name":"atomic unit of frequency","symbol":"Eh/ħ","multi":2.418e14}, // Hartree/ħ
];
    linearFromArray(_frequencies, 'Frequency');

    // Angle
const _angles = [
  {"name":"radian","symbol":"rad","multi":1, isSI:true},

  // Degrees
  {"name":"degree","symbol":"°","multi":57.2957795131}, // 180/π
  {"name":"arcminute","symbol":"′","multi":3437.74677078}, // 60 per degree
  {"name":"arcsecond","symbol":"″","multi":206264.806247}, // 60 per arcminute

  // Turns / revolutions
  {"name":"turn (revolution)","symbol":"rev","multi":0.1591549431}, // 1/(2π)
  {"name":"quadrant","symbol":"quad","multi":0.25/Math.PI}, // 90° = π/2 rad
  {"name":"sextant","symbol":"sext","multi":0.3333333333/Math.PI}, // 60° = π/3 rad

  // Gradians
  {"name":"gradian (gon)","symbol":"gon","multi":63.6619772368}, // 200/π
  {"name":"centesimal arcminute","symbol":"c′","multi":6366.19772368}, // 100 per grad
  {"name":"centesimal arcsecond","symbol":"c″","multi":636619.772368}, // 100 per c′

  // Milliradians
  {"name":"milliradian","symbol":"mrad","multi":1000},
  {"name":"microradian","symbol":"µrad","multi":1e6},

  // Full circle fractions
  {"name":"binary degree (brad)","symbol":"brad","multi":40.7436654315}, // 1 rad = ~40.74 brads (1 circle = 256 brads)
  {"name":"octant","symbol":"oct","multi":0.25/Math.PI*2}, // 45° = π/4 rad
  {"name":"point (compass)","symbol":"pt","multi":101.8591636}, // 1/32 of a circle

  // Astronomical / physical
  {"name":"hour angle","symbol":"h","multi":3.819718634}, // 15° per hour
  {"name":"minute of time","symbol":"min t","multi":229.183118}, // 15′ per minute
  {"name":"second of time","symbol":"s t","multi":13750.9871}, // 15″ per second

  // Natural / constants
  {"name":"Planck angle","symbol":"θP","multi":2.06e61} // ~1 rad = 2.06×10^61 Planck angles
];
    linearFromArray(_angles, 'Angle');

    // Data Storage
const _dataStorage = [
  {"name":"bit","symbol":"b","multi":8}, // 1 B = 8 bits
  {"name":"nibble","symbol":"nib","multi":2}, // 4 bits

  // Base unit
  {"name":"byte","symbol":"B","multi":1,isSI:true},

  // Decimal multiples (SI, powers of 10)
  {"name":"kilobyte (SI)","symbol":"kB","multi":0.001}, // 1 kB = 1000 B
  {"name":"megabyte (SI)","symbol":"MB","multi":1e-6},
  {"name":"gigabyte (SI)","symbol":"GB","multi":1e-9},
  {"name":"terabyte (SI)","symbol":"TB","multi":1e-12},
  {"name":"petabyte (SI)","symbol":"PB","multi":1e-15},
  {"name":"exabyte (SI)","symbol":"EB","multi":1e-18},
  {"name":"zettabyte (SI)","symbol":"ZB","multi":1e-21},
  {"name":"yottabyte (SI)","symbol":"YB","multi":1e-24},

  // Binary multiples (IEC, powers of 2)
  {"name":"kibibyte","symbol":"KiB","multi":1/1024}, // 1024 B
  {"name":"mebibyte","symbol":"MiB","multi":1/1048576}, // 1024²
  {"name":"gibibyte","symbol":"GiB","multi":1/1073741824}, // 1024³
  {"name":"tebibyte","symbol":"TiB","multi":1/1099511627776}, // 1024⁴
  {"name":"pebibyte","symbol":"PiB","multi":1/1125899906842624}, // 1024⁵
  {"name":"exbibyte","symbol":"EiB","multi":1/1152921504606846976}, // 1024⁶
  {"name":"zebibyte","symbol":"ZiB","multi":1/1180591620717411303424}, // 1024⁷
  {"name":"yobibyte","symbol":"YiB","multi":1/1208925819614629174706176}, // 1024⁸

  // Legacy / historical
  {"name":"word (16-bit)","symbol":"word","multi":0.5}, // 2 bytes
  {"name":"double word (32-bit)","symbol":"dword","multi":0.25}, // 4 bytes
  {"name":"quad word (64-bit)","symbol":"qword","multi":0.125}, // 8 bytes
  {"name":"floppy disk (3.5\" DD)","symbol":"FD","multi":2.7778e-7}, // 720 KB
  {"name":"CD-ROM (700 MB)","symbol":"CD","multi":1.43e-9},
  {"name":"DVD (4.7 GB)","symbol":"DVD","multi":2.13e-10}
];
    linearFromArray(_dataStorage, 'Data Storage');

    // Data Transfer Rate (bits per second)
const _dataRates = [
  {"name":"bit per second","symbol":"bps","multi":1, isSI:true},

  // Bytes per second
  {"name":"byte per second","symbol":"B/s","multi":0.125}, // 1 B = 8 b

  // Decimal multiples (SI, powers of 10)
  {"name":"kilobit per second","symbol":"kbps","multi":0.001},
  {"name":"megabit per second","symbol":"Mbps","multi":1e-6},
  {"name":"gigabit per second","symbol":"Gbps","multi":1e-9},
  {"name":"terabit per second","symbol":"Tbps","multi":1e-12},
  {"name":"petabit per second","symbol":"Pbps","multi":1e-15},
  {"name":"exabit per second","symbol":"Ebps","multi":1e-18},

  {"name":"kilobyte per second","symbol":"kB/s","multi":0.000125},
  {"name":"megabyte per second","symbol":"MB/s","multi":1.25e-7},
  {"name":"gigabyte per second","symbol":"GB/s","multi":1.25e-10},
  {"name":"terabyte per second","symbol":"TB/s","multi":1.25e-13},

  // Binary multiples (IEC, powers of 2)
  {"name":"kibibit per second","symbol":"Kibps","multi":1/1024},
  {"name":"mebibit per second","symbol":"Mibps","multi":1/1048576},
  {"name":"gibibit per second","symbol":"Gibps","multi":1/1073741824},
  {"name":"tebibit per second","symbol":"Tibps","multi":1/1099511627776},

  {"name":"kibibyte per second","symbol":"KiB/s","multi":1/8192}, // 1024 B/s
  {"name":"mebibyte per second","symbol":"MiB/s","multi":1/8388608}, // 1024² B/s
  {"name":"gibibyte per second","symbol":"GiB/s","multi":1/8589934592}, // 1024³ B/s
  {"name":"tebibyte per second","symbol":"TiB/s","multi":1/8796093022208}, // 1024⁴ B/s

  // Telecom / legacy
  {"name":"baud (symbols per second)","symbol":"Bd","multi":1}, // 1 Bd = 1 symbol/s, often = 1 bps
  {"name":"E1 line (Europe)","symbol":"E1","multi":1/2048000}, // 2.048 Mbps
  {"name":"T1 line (US)","symbol":"T1","multi":1/1544000}, // 1.544 Mbps
  {"name":"OC-1 (optical carrier)","symbol":"OC-1","multi":1/51840000}, // 51.84 Mbps
  {"name":"OC-3","symbol":"OC-3","multi":1/155520000}, // 155.52 Mbps
  {"name":"OC-12","symbol":"OC-12","multi":1/622080000}, // 622.08 Mbps
  {"name":"OC-48","symbol":"OC-48","multi":1/2488320000}, // 2.488 Gbps
  {"name":"OC-192","symbol":"OC-192","multi":1/9953280000} // 9.953 Gbps
];
    linearFromArray(_dataRates, 'Data Transfer Rate');

    // Electric Current
const _currents = [
  {"name":"ampere","symbol":"A","multi":1,isSI:true},

  // SI multiples
  {"name":"kiloampere","symbol":"kA","multi":0.001},
  {"name":"megaampere","symbol":"MA","multi":1e-6},
  {"name":"gigaampere","symbol":"GA","multi":1e-9},

  // SI submultiples
  {"name":"milliampere","symbol":"mA","multi":1000},
  {"name":"microampere","symbol":"µA","multi":1e6},
  {"name":"nanoampere","symbol":"nA","multi":1e9},
  {"name":"picoampere","symbol":"pA","multi":1e12},
  {"name":"femtoampere","symbol":"fA","multi":1e15},
  {"name":"attoampere","symbol":"aA","multi":1e18},

  // CGS / electromagnetic units
  {"name":"biot (abampere)","symbol":"Bi / abA","multi":0.1}, // 1 abA = 10 A
  {"name":"statampere","symbol":"statA","multi":2.99792458e9}, // 1 statA ≈ 3.336e-10 A

  // Practical / historical
  {"name":"gilbert (magnetomotive force per turn)","symbol":"Gb","multi":0.7957747}, // 1 Gb ≈ 0.7958 A-turn
  {"name":"esu of current","symbol":"esu/s","multi":2.99792458e9}, // same as statA
  {"name":"Planck current","symbol":"Ip","multi":1.8755e-19} // 1 A ≈ 1.88e-19 Planck currents
];
    linearFromArray(_currents, 'Electric Current');

    // Voltage
const _voltages = [
  {"name":"volt","symbol":"V","multi":1,isSI:true},

  // SI multiples
  {"name":"kilovolt","symbol":"kV","multi":0.001},
  {"name":"megavolt","symbol":"MV","multi":1e-6},
  {"name":"gigavolt","symbol":"GV","multi":1e-9},
  {"name":"teravolt","symbol":"TV","multi":1e-12},

  // SI submultiples
  {"name":"millivolt","symbol":"mV","multi":1000},
  {"name":"microvolt","symbol":"µV","multi":1e6},
  {"name":"nanovolt","symbol":"nV","multi":1e9},
  {"name":"picovolt","symbol":"pV","multi":1e12},
  {"name":"femtovolt","symbol":"fV","multi":1e15},
  {"name":"attovolt","symbol":"aV","multi":1e18},

  // CGS / legacy
  {"name":"abvolt","symbol":"abV","multi":1e8}, // 1 abV = 1e-8 V
  {"name":"statvolt","symbol":"statV","multi":299.792458}, // 1 statV ≈ 299.79 V

  // Derived / practical
  {"name":"electronvolt per elementary charge","symbol":"eV/e","multi":6.241509074e18},
  // 1 V = 1 J/C, so 1 eV/e = 1 V

  // Natural / physical constants
  {"name":"Planck voltage","symbol":"Vp","multi":2.92e-27}, // ~1.04×10^27 V
];
    linearFromArray(_voltages, 'Voltage');

    // Resistance
const _resistances = [
  {"name":"ohm","symbol":"Ω","multi":1,isSI:true},

  // SI multiples
  {"name":"kilohm","symbol":"kΩ","multi":0.001},
  {"name":"megohm","symbol":"MΩ","multi":1e-6},
  {"name":"gigohm","symbol":"GΩ","multi":1e-9},
  {"name":"terohm","symbol":"TΩ","multi":1e-12},

  // SI submultiples
  {"name":"milliohm","symbol":"mΩ","multi":1000},
  {"name":"microohm","symbol":"µΩ","multi":1e6},
  {"name":"nanoohm","symbol":"nΩ","multi":1e9},
  {"name":"picoohm","symbol":"pΩ","multi":1e12},

  // CGS / legacy
  {"name":"abohm","symbol":"abΩ","multi":1e9}, // 1 abΩ = 1e-9 Ω
  {"name":"statohm","symbol":"statΩ","multi":8.98755179e11}, // 1 statΩ ≈ 8.99×10^11 Ω

  // Conductance inverses
  {"name":"siemens (reciprocal ohm)","symbol":"S","multi":1}, // 1 Ω = 1 S⁻¹
  {"name":"mho","symbol":"℧","multi":1}, // synonym for siemens

  // Natural / physical constants
  {"name":"quantum of resistance (von Klitzing constant)","symbol":"R_K","multi":3.8740459e-5},
  // 1 Ω ≈ 3.874×10⁻⁵ R_K, where R_K ≈ 25812.807 Ω

  {"name":"Planck resistance","symbol":"Rp","multi":3.8740459e-5}
  // ~29.9792458 Ω, so 1 Ω ≈ 0.03336 Rp
];
    linearFromArray(_resistances, 'Resistance');

    // Capacitance
const _capacitances = [
  {"name":"farad","symbol":"F","multi":1,isSI:true},

  // SI multiples
  {"name":"kilofarad","symbol":"kF","multi":0.001},
  {"name":"megafarad","symbol":"MF","multi":1e-6},
  {"name":"gigafarad","symbol":"GF","multi":1e-9},

  // SI submultiples
  {"name":"millifarad","symbol":"mF","multi":1000},
  {"name":"microfarad","symbol":"µF","multi":1e6},
  {"name":"nanofarad","symbol":"nF","multi":1e9},
  {"name":"picofarad","symbol":"pF","multi":1e12},
  {"name":"femtofarad","symbol":"fF","multi":1e15},
  {"name":"attofarad","symbol":"aF","multi":1e18},

  // CGS / legacy
  {"name":"abfarad","symbol":"abF","multi":1e-9}, // 1 abF = 1e9 F
  {"name":"statfarad","symbol":"statF","multi":1.11265e-12}, // 1 statF ≈ 1.11265e-12 F

  // Natural / physical constants
  {"name":"Planck capacitance","symbol":"Cp","multi":1.17e-20}
  // ~1.875e-30 F, so 1 F ≈ 5.34e29 Cp
];
    linearFromArray(_capacitances, 'Capacitance');

const _charges = [
  {"name":"coulomb","symbol":"C","multi":1}, // SI base

  // SI multiples
  {"name":"kilocoulomb","symbol":"kC","multi":0.001},
  {"name":"megacoulomb","symbol":"MC","multi":1e-6},
  {"name":"gigacoulomb","symbol":"GC","multi":1e-9},

  // SI submultiples
  {"name":"millicoulomb","symbol":"mC","multi":1000},
  {"name":"microcoulomb","symbol":"µC","multi":1e6},
  {"name":"nanocoulomb","symbol":"nC","multi":1e9},
  {"name":"picocoulomb","symbol":"pC","multi":1e12},
  {"name":"femtocoulomb","symbol":"fC","multi":1e15},
  {"name":"attocoulomb","symbol":"aC","multi":1e18},

  // Practical / engineering
  {"name":"ampere-hour","symbol":"Ah","multi":2.7777778e-4}, // 1 Ah = 3600 C
  {"name":"milliampere-hour","symbol":"mAh","multi":0.2777778}, // 1 mAh = 3.6 C

  // Elementary charge
  {"name":"elementary charge","symbol":"e","multi":6.241509074e18},
  // 1 C = ~6.24×10^18 e

  // CGS / legacy
  {"name":"abcoulomb (abC)","symbol":"abC","multi":0.1}, // 1 abC = 10 C
  {"name":"statcoulomb (esu)","symbol":"statC","multi":2.99792458e9}, // 1 C ≈ 2.998×10^9 statC

  // Natural / physical constants
  {"name":"Planck charge","symbol":"qP","multi":5.29e-19}
  // 1 C ≈ 1.88×10^18 qP, qP ≈ 1.875e-18 C
];
    linearFromArray(_charges, 'Charges');

    // Inductance
const _inductances = [
  {"name":"henry","symbol":"H","multi":1,isSI:true},

  // SI multiples
  {"name":"kilohenry","symbol":"kH","multi":0.001},
  {"name":"megahenry","symbol":"MH","multi":1e-6},
  {"name":"gigahenry","symbol":"GH","multi":1e-9},

  // SI submultiples
  {"name":"millihenry","symbol":"mH","multi":1000},
  {"name":"microhenry","symbol":"µH","multi":1e6},
  {"name":"nanohenry","symbol":"nH","multi":1e9},
  {"name":"picohenry","symbol":"pH","multi":1e12},
  {"name":"femtohenry","symbol":"fH","multi":1e15},
  {"name":"attohenry","symbol":"aH","multi":1e18},

  // CGS / legacy
  {"name":"abhenry","symbol":"abH","multi":1e9}, // 1 abH = 1e-9 H
  {"name":"stathenry","symbol":"stH","multi":8.98755179e11}, // 1 stH ≈ 8.99×10^11 H

  // Natural / physical constants
  {"name":"Planck inductance","symbol":"Lp","multi":2.65e-11}
  // ~1.62e-33 H, so 1 H ≈ 6.17e32 Lp
];
    linearFromArray(_inductances, 'Inductance');

const _fluxes = [
  {"name":"weber","symbol":"Wb","multi":1,isSI:true}, // SI base

  // SI multiples
  {"name":"kiloweber","symbol":"kWb","multi":0.001},
  {"name":"megaweber","symbol":"MWb","multi":1e-6},
  {"name":"gigaweber","symbol":"GWb","multi":1e-9},

  // SI submultiples
  {"name":"milliweber","symbol":"mWb","multi":1000},
  {"name":"microweber","symbol":"µWb","multi":1e6},
  {"name":"nanoweber","symbol":"nWb","multi":1e9},
  {"name":"picoweber","symbol":"pWb","multi":1e12},
  {"name":"femtoweber","symbol":"fWb","multi":1e15},
  {"name":"attoweber","symbol":"aWb","multi":1e18},

  // CGS / legacy
  {"name":"maxwell","symbol":"Mx","multi":1e8}, // 1 Wb = 10^8 Mx
  {"name":"gauss·cm²","symbol":"G·cm²","multi":1e8}, // identical to maxwell

  // Practical / engineering
  {"name":"volt-second","symbol":"V·s","multi":1}, // 1 Wb = 1 V·s

  // Natural / physical constants
  {"name":"magnetic flux quantum","symbol":"Φ₀","multi":4.834e14},
  // Φ₀ ≈ 2.067833848e-15 Wb, so 1 Wb ≈ 4.83×10^14 Φ₀

  {"name":"Planck magnetic flux","symbol":"Φp","multi":6.17e33}
  // ~2.07×10^-15 Wb, so 1 Wb ≈ 6.17×10^33 Φp
];
    linearFromArray(_fluxes, 'Magenetic Flux');

const _fluxDensities = [
  {"name":"tesla","symbol":"T","multi":1,isSI:true}, // SI base: 1 T = 1 Wb/m²

  // SI multiples
  {"name":"kilotesla","symbol":"kT","multi":0.001},
  {"name":"megatesla","symbol":"MT","multi":1e-6},
  {"name":"gigatesla","symbol":"GT","multi":1e-9},

  // SI submultiples
  {"name":"millitesla","symbol":"mT","multi":1000},
  {"name":"microtesla","symbol":"µT","multi":1e6},
  {"name":"nanotesla","symbol":"nT","multi":1e9},
  {"name":"picotesla","symbol":"pT","multi":1e12},
  {"name":"femtotesla","symbol":"fT","multi":1e15},
  {"name":"attotesla","symbol":"aT","multi":1e18},

  // CGS / legacy
  {"name":"gauss","symbol":"G","multi":10000}, // 1 T = 10,000 G
  {"name":"maxwell per square centimeter","symbol":"Mx/cm²","multi":10000}, // identical to gauss

  // Practical / geophysical
  {"name":"gamma","symbol":"γ","multi":1e9}, // 1 γ = 1 nT

  // Natural / physical constants
  {"name":"Planck magnetic flux density","symbol":"Bp","multi":2.95e-54}
  // ~1 T ≈ 2.95×10⁻⁵⁴ Bp, Planck B ≈ 1.2×10^53 T
];
    linearFromArray(_fluxDensities, 'Magenetic Flux Density');

const _mmfs = [
  {"name":"ampere-turn","symbol":"At","multi":1,isSI:true},
  // SI base: 1 At = current (A) × number of turns

  // Multiples
  {"name":"kiloampere-turn","symbol":"kAt","multi":0.001},
  {"name":"megaampere-turn","symbol":"MAt","multi":1e-6},

  // Submultiples
  {"name":"milliampere-turn","symbol":"mAt","multi":1000},
  {"name":"microampere-turn","symbol":"µAt","multi":1e6},

  // CGS / legacy
  {"name":"gilbert","symbol":"Gb","multi":0.01256637},
  // 1 Gb = (10/4π) At ≈ 0.7957747 At → 1 At ≈ 1.257 Gb

  // Natural / physical constants
  {"name":"Planck magnetomotive force","symbol":"Fp","multi":~3.5e-45}
  // extremely small natural unit, rarely used outside theory
];
    linearFromArray(_mmfs, 'Magnetomotive Force');

    // Luminosity / Light
const _luminosities = [
  // Base SI units
  {"name":"lumen","symbol":"lm","multi":1,isSI:true}, // luminous flux
  {"name":"candela·steradian","symbol":"cd·sr","multi":1}, // equivalent to lumen

  // Luminous intensity
  {"name":"candela","symbol":"cd","multi":1}, // 1 cd = 1 lm/sr

  // Flux multiples
  {"name":"kilolumen","symbol":"klm","multi":0.001},
  {"name":"megalumen","symbol":"Mlm","multi":1e-6},

  // Flux submultiples
  {"name":"millilumen","symbol":"mlm","multi":1000},
  {"name":"microlumen","symbol":"µlm","multi":1e6},

  // Intensity multiples
  {"name":"kilocandela","symbol":"kcd","multi":0.001},
  {"name":"megacandela","symbol":"Mcd","multi":1e-6},

  // Intensity submultiples
  {"name":"millicandela","symbol":"mcd","multi":1000},
  {"name":"microcandela","symbol":"µcd","multi":1e6},

  // Practical / legacy
  {"name":"candlepower (international)","symbol":"cp","multi":1}, // ≈ candela
  {"name":"hefnerkerze (Hefner candle)","symbol":"HK","multi":0.903}, // ~0.903 cd
  {"name":"carcel unit","symbol":"Carcel","multi":9.74}, // ~9.74 cd

  // Astronomical luminosity
  {"name":"solar luminosity","symbol":"L☉","multi":2.613e-27},
  // 1 W luminous ≈ 3.828e26 W radiant, but photometric luminous flux depends on spectrum

  // Natural / physical constants
  {"name":"Planck luminous intensity","symbol":"Ip","multi":~3.5e-113}
  // extremely small, natural unit
];
    linearFromArray(_luminosities, 'Luminosity');

const _illuminances = [
  {"name":"lux","symbol":"lx","multi":1,isSI:true}, // SI base: 1 lx = 1 lm/m²

  // SI multiples
  {"name":"kilolux","symbol":"klx","multi":0.001},
  {"name":"megalux","symbol":"Mlx","multi":1e-6},

  // SI submultiples
  {"name":"millilux","symbol":"mlx","multi":1000},
  {"name":"microlux","symbol":"µlx","multi":1e6},
  {"name":"nanolux","symbol":"nlx","multi":1e9},

  // CGS / legacy
  {"name":"phot","symbol":"ph","multi":1e-4}, // 1 ph = 10,000 lx
  {"name":"milliphot","symbol":"mph","multi":0.1}, // 1 mph = 10 lx
  {"name":"lambert","symbol":"L","multi":0.0001}, // 1 L = 10,000/π lx ≈ 3183 lx

  // Imperial / US customary
  {"name":"foot-candle","symbol":"fc","multi":0.09290304}, // 1 fc = 10.764 lx
  {"name":"foot-lambert","symbol":"fL","multi":0.0002918635}, // 1 fL ≈ 3.426 cd/m² → 3.426 lx for diffuse

  // Astronomical / natural
  {"name":"sunlight (direct, noon)","symbol":"☉ noon","multi":0.000092}, // ~100,000 lx
  {"name":"full moonlight","symbol":"☾ full","multi":50}, // ~0.02 lx
  {"name":"starlight (clear night)","symbol":"✦","multi":5e4}, // ~2e-5 lx

  // Natural / physical constants
  {"name":"Planck illuminance","symbol":"Ip","multi":~3.5e-113} // extremely small natural unit
];
    linearFromArray(_illuminances, 'Illuminance');

const _luminances = [
  {"name":"candela per square meter","symbol":"cd/m²","multi":1,isSI:true}, // SI base, also called "nit"
  {"name":"nit","symbol":"nt","multi":1}, // synonym for cd/m²

  // SI multiples
  {"name":"kilocandela per square meter","symbol":"kcd/m²","multi":0.001},
  {"name":"megacandela per square meter","symbol":"Mcd/m²","multi":1e-6},

  // SI submultiples
  {"name":"millicandela per square meter","symbol":"mcd/m²","multi":1000},
  {"name":"microcandela per square meter","symbol":"µcd/m²","multi":1e6},

  // CGS / legacy
  {"name":"stilb","symbol":"sb","multi":0.0001}, // 1 sb = 10,000 cd/m²
  {"name":"apostilb","symbol":"asb","multi":0.3183099}, // 1/π cd/m²
  {"name":"lambert","symbol":"L","multi":0.0003141593}, // 1 L = 1/π cd/cm² = 3183 cd/m²
  {"name":"millilambert","symbol":"mL","multi":0.3141593}, // 1 mL = 3.183 cd/m²
  {"name":"foot-lambert","symbol":"fL","multi":0.2918635}, // 1 fL ≈ 3.426 cd/m²

  // Practical / industry
  {"name":"skot","symbol":"sk","multi":3.1831e4}, // 1 skot = 0.001 asb
  {"name":"bril","symbol":"bril","multi":3.1831e7}, // 1 bril = 1e-9 asb

  // Astronomical / natural references
  {"name":"solar disc luminance","symbol":"☉","multi":2.0e-5}, // ~1.6×10^9 cd/m²
  {"name":"full moon luminance","symbol":"☾","multi":2.0e3}, // ~0.25 cd/m²

  // Natural / physical constants
  {"name":"Planck luminance","symbol":"Lp","multi":~3.5e-113} // extremely small natural unit
];
    linearFromArray(_luminances, 'Luminance');

    // Fuel Economy (expressed in L/100km as SI-ish) and mpg (UK/US)
const _fuelEconomy = [
  // Base
  {"name":"kilometer per liter","symbol":"km/L","multi":1,isSI:true},

  // Metric reciprocal
  {"name":"liter per 100 kilometers","symbol":"L/100km","multi":100},
  // 1 km/L = 100 L/100km

  // Imperial / US customary
  {"name":"mile per gallon (US)","symbol":"mpg(US)","multi":2.35215},
  // 1 km/L ≈ 2.35215 mpg(US)

  {"name":"mile per gallon (Imperial)","symbol":"mpg(Imp)","multi":2.82481},
  // 1 km/L ≈ 2.82481 mpg(Imp)

  // Metric variants
  {"name":"meter per liter","symbol":"m/L","multi":1000},
  {"name":"kilometer per gallon (US)","symbol":"km/gal(US)","multi":3.78541},
  {"name":"kilometer per gallon (Imperial)","symbol":"km/gal(Imp)","multi":4.54609},

  // US customary variants
  {"name":"mile per liter","symbol":"mi/L","multi":1.60934},
  {"name":"mile per cubic meter","symbol":"mi/m³","multi":0.000621371},

  // SI derived
  {"name":"meter per cubic meter","symbol":"m/m³","multi":1000},
  // essentially distance per volume in base SI

  // Practical / industry
  {"name":"gallon per 100 miles (US)","symbol":"gal/100mi(US)","multi":235.215},
  // 1 km/L ≈ 235.215 gal/100mi(US)

  {"name":"gallon per 100 miles (Imp)","symbol":"gal/100mi(Imp)","multi":282.481}
  // 1 km/L ≈ 282.481 gal/100mi(Imp)
];
    linearFromArray(_fuelEconomy, 'Fuel Economy');

    // Density (kg/m^3)
const _densities = [
  {"name":"kilogram per cubic meter","symbol":"kg/m³","multi":1,isSI:true}, // SI base

  // SI multiples
  {"name":"gram per cubic meter","symbol":"g/m³","multi":1000}, // 1 kg/m³ = 1000 g/m³
  {"name":"milligram per cubic meter","symbol":"mg/m³","multi":1e6},
  {"name":"microgram per cubic meter","symbol":"µg/m³","multi":1e9},

  {"name":"kilogram per liter","symbol":"kg/L","multi":0.001}, // 1 kg/L = 1000 kg/m³
  {"name":"gram per cubic centimeter","symbol":"g/cm³","multi":0.001}, // 1 g/cm³ = 1000 kg/m³
  {"name":"gram per milliliter","symbol":"g/mL","multi":0.001}, // same as g/cm³

  // CGS
  {"name":"gram per cubic centimeter (CGS)","symbol":"g/cm³","multi":0.001},
  {"name":"gram per cubic decimeter","symbol":"g/dm³","multi":1}, // 1 g/dm³ = 1 kg/m³

  // Imperial / US customary
  {"name":"pound per cubic foot","symbol":"lb/ft³","multi":0.06242796}, // 1 kg/m³ ≈ 0.0624 lb/ft³
  {"name":"pound per cubic inch","symbol":"lb/in³","multi":3.61273e-5}, // 1 kg/m³ ≈ 3.61×10⁻⁵ lb/in³
  {"name":"ounce per cubic inch","symbol":"oz/in³","multi":5.779e-4}, // 1 kg/m³ ≈ 5.78×10⁻⁴ oz/in³
  {"name":"slug per cubic foot","symbol":"slug/ft³","multi":0.00194032}, // 1 slug/ft³ = 515.3788 kg/m³

  // Practical / reference
  {"name":"water at 4°C","symbol":"ρH₂O","multi":0.001}, // 1000 kg/m³
  {"name":"air at STP","symbol":"ρair","multi":0.816}, // ~1.225 kg/m³

  // Natural / physical constants
  {"name":"Planck density","symbol":"ρp","multi":2.37e-96}
  // Planck density ≈ 5.16×10^96 kg/m³, so 1 kg/m³ ≈ 2.37×10⁻⁹⁶ ρp
];
    linearFromArray(_densities, 'Density');

const _dynamicViscosities = [
  {"name":"pascal-second","symbol":"Pa·s","multi":1,isSI:true}, // SI base

  // SI multiples/submultiples
  {"name":"millipascal-second","symbol":"mPa·s","multi":1000}, // 1 Pa·s = 1000 mPa·s
  {"name":"micropascal-second","symbol":"µPa·s","multi":1e6},

  // CGS
  {"name":"poise","symbol":"P","multi":10}, // 1 P = 0.1 Pa·s → 1 Pa·s = 10 P
  {"name":"centipoise","symbol":"cP","multi":1000}, // 1 cP = 1 mPa·s

  // Imperial / US customary
  {"name":"pound-force second per square foot","symbol":"lbf·s/ft²","multi":0.0208854},
  {"name":"pound-force second per square inch","symbol":"lbf·s/in²","multi":0.000145038},

  // Practical references
  {"name":"water at 20°C","symbol":"ηH₂O","multi":1000}, // ~1.0 mPa·s
  {"name":"honey (room temp)","symbol":"ηhoney","multi":1e5} // ~100 Pa·s
];
    linearFromArray(_dynamicViscosities, 'Dynamic Viscosities');

const _kinematicViscosities = [
  {"name":"square meter per second","symbol":"m²/s","multi":1,isSI:true}, // SI base

  // SI submultiples
  {"name":"square millimeter per second","symbol":"mm²/s","multi":1e6}, // 1 mm²/s = 1 cSt
  {"name":"square centimeter per second","symbol":"cm²/s","multi":1e4},

  // CGS
  {"name":"stokes","symbol":"St","multi":1e4}, // 1 St = 1 cm²/s = 1e-4 m²/s → 1 m²/s = 1e4 St
  {"name":"centistokes","symbol":"cSt","multi":1e6}, // 1 cSt = 1 mm²/s = 1e-6 m²/s

  // Imperial / US customary
  {"name":"square foot per second","symbol":"ft²/s","multi":10.7639},
  {"name":"square inch per second","symbol":"in²/s","multi":1550.003},

  // Practical references
  {"name":"water at 20°C","symbol":"νH₂O","multi":1e6}, // ~1.0 cSt
  {"name":"air at 20°C","symbol":"νair","multi":1.5e5} // ~0.15 cm²/s
];
    linearFromArray(_kinematicViscosities, 'Kinematic Viscosities');

const _radioactivity = [
  {"name":"becquerel","symbol":"Bq","multi":1,isSI:true}, // SI base: 1 decay/s

  // Multiples
  {"name":"kilobecquerel","symbol":"kBq","multi":0.001},
  {"name":"megabecquerel","symbol":"MBq","multi":1e-6},
  {"name":"gigabecquerel","symbol":"GBq","multi":1e-9},
  {"name":"terabecquerel","symbol":"TBq","multi":1e-12},

  // Legacy
  {"name":"curie","symbol":"Ci","multi":2.703e-11},
  // 1 Ci = 3.7×10^10 Bq → 1 Bq ≈ 2.703×10^-11 Ci

  {"name":"millicurie","symbol":"mCi","multi":2.703e-8},
  {"name":"microcurie","symbol":"µCi","multi":2.703e-5},

  // Practical reference
  {"name":"disintegrations per minute","symbol":"dpm","multi":60},
  // 1 Bq = 60 dpm
];
    linearFromArray(_radioactivity, 'Radioactivity');

const _radiationFlux = [
  {"name":"per square meter per second","symbol":"1/(m²·s)","multi":1,isSI:true}, // SI base

  // Metric submultiples
  {"name":"per square centimeter per second","symbol":"1/(cm²·s)","multi":1e-4},
  // 1 cm² = 1e-4 m² → 1/(cm²·s) = 1e4 /(m²·s)

  {"name":"per square millimeter per second","symbol":"1/(mm²·s)","multi":1e-6},

  // Particle-specific
  {"name":"neutrons per square centimeter per second","symbol":"n/(cm²·s)","multi":1e-4},
  {"name":"photons per square centimeter per second","symbol":"γ/(cm²·s)","multi":1e-4},
  {"name":"protons per square centimeter per second","symbol":"p/(cm²·s)","multi":1e-4},

  // Integrated fluence (per area, no time)
  {"name":"per square meter","symbol":"1/m²","multi":1},
  {"name":"per square centimeter","symbol":"1/cm²","multi":1e-4},

  // Nuclear physics cross-section related
  {"name":"per barn per second","symbol":"1/(b·s)","multi":1e28},
  // 1 barn = 1e-28 m² → 1/(b·s) = 1e28 /(m²·s)

  // Practical references
  {"name":"solar photon flux at Earth","symbol":"Φ☉","multi":5e21},
  // ~4×10^17 photons/cm²·s = 4×10^21 photons/m²·s

  {"name":"cosmic ray flux at sea level","symbol":"ΦCR","multi":1e-2}
  // ~1 particle/cm²·s = 1e4 /(m²·s)
];
    linearFromArray(_radiationFlux, 'Radiation Flux');

    // Flow Rate (m^3/s)
const _volumetricFlow = [
  {"name":"cubic meter per second","symbol":"m³/s","multi":1,isSI:true}, // SI base

  // SI multiples/submultiples
  {"name":"liter per second","symbol":"L/s","multi":1000}, // 1 m³/s = 1000 L/s
  {"name":"liter per minute","symbol":"L/min","multi":60000},
  {"name":"liter per hour","symbol":"L/h","multi":3.6e6},

  {"name":"milliliter per second","symbol":"mL/s","multi":1e6},
  {"name":"cubic centimeter per second","symbol":"cm³/s","multi":1e6},

  // Larger SI
  {"name":"cubic meter per minute","symbol":"m³/min","multi":60},
  {"name":"cubic meter per hour","symbol":"m³/h","multi":3600},

  // Imperial / US customary
  {"name":"cubic foot per second","symbol":"ft³/s","multi":35.3147},
  {"name":"cubic foot per minute","symbol":"cfm","multi":2118.88},
  {"name":"cubic foot per hour","symbol":"ft³/h","multi":127132.8},

  {"name":"gallon per minute (US)","symbol":"gpm(US)","multi":15850.3},
  {"name":"gallon per hour (US)","symbol":"gph(US)","multi":951019},

  {"name":"gallon per minute (Imperial)","symbol":"gpm(Imp)","multi":13198.2},
  {"name":"gallon per hour (Imperial)","symbol":"gph(Imp)","multi":791892},

  // Practical / industry
  {"name":"barrel per day (oil, US)","symbol":"bbl/d","multi":543439},
  // 1 m³/s ≈ 543,439 bbl/d
];
    linearFromArray(_volumetricFlow, 'Volumetric Flow');

const _massFlow = [
  {"name":"kilogram per second","symbol":"kg/s","multi":1,isSI:true}, // SI base

  // SI multiples/submultiples
  {"name":"gram per second","symbol":"g/s","multi":1000},
  {"name":"milligram per second","symbol":"mg/s","multi":1e6},

  {"name":"kilogram per minute","symbol":"kg/min","multi":60},
  {"name":"kilogram per hour","symbol":"kg/h","multi":3600},

  {"name":"tonne per hour","symbol":"t/h","multi":3.6}, // 1 t/h = 1000/3600 kg/s

  // Imperial / US customary
  {"name":"pound per second","symbol":"lb/s","multi":2.20462},
  {"name":"pound per minute","symbol":"lb/min","multi":132.277},
  {"name":"pound per hour","symbol":"lb/h","multi":7936.64},

  {"name":"short ton per hour (US)","symbol":"st/h","multi":3.96832},
  {"name":"long ton per hour (Imperial)","symbol":"lt/h","multi":3.5433}
];
    linearFromArray(_massFlow, 'Mass Flow');

    // Generate some compound units automatically (Areas/Volumes/Speeds) where sensible
    // Not exhaustive; main types are created above. Return array.
    return u;
  })();

  // index map: type -> [unitObjects]
  const UnitsByType = Units.reduce((acc, unit) => {
    acc[unit.type] = acc[unit.type] || [];
    acc[unit.type].push(unit);
    return acc;
  }, {});

  // list of types
  const Types = Object.keys(UnitsByType).sort();

  // default settings
  const state = {
    type: config.initial.type || Types[0],
    sigfigs: config.initial.sigfigs !== undefined ? clampInt(config.initial.sigfigs, 1, 15) : 6,
    decimals: config.initial.decimals !== undefined ? config.initial.decimals : null, // null means use sigfigs
    pinnedFrom: config.initial.pinnedFrom || null,
    pinnedTo: config.initial.pinnedTo || null,
    lastInputUnit: null,
    lastInputValue: null,
  };

  // programmatic convert core
  function convertValue(type, unitName, value) {
    const units = UnitsByType[type] || [];
    const src = units.find((u) => u.name === unitName || u.symbol === unitName);
    if (!src) throw new Error(`Unit "${unitName}" not found in type "${type}"`);
    const v = safeNumber(value);
    if (v === null) return null;
    const si = src.toSI(v);
    const results = units.map((tgt) => {
      return {
        name: tgt.name,
        symbol: tgt.symbol,
        isSI: !!tgt.isSI,
        value: tgt.fromSI(si),
      };
    });
    return { source: src.name, sourceSymbol: src.symbol, si, results };
  }

  // programmatic API
  const api = {
    getTypes: () => Types.slice(),
    getUnits: (type) => {
      if (!type) return Units.slice();
      return (UnitsByType[type] || []).map((u) => ({ name: u.name, symbol: u.symbol, isSI: !!u.isSI }));
    },
    getUnit: (type, unitName) => {
      const units = UnitsByType[type] || [];
      const found = units.find((u) => u.name === unitName || u.symbol === unitName);
      return found ? { name: found.name, symbol: found.symbol, isSI: !!found.isSI } : null;
    },
    convert: (type, unitName, value, opts = {}) => {
      const sig = opts.sigfigs !== undefined ? opts.sigfigs : state.sigfigs;
      const dec = opts.decimals !== undefined ? opts.decimals : state.decimals;
      const raw = convertValue(type, unitName, value);
      if (!raw) return null;
      const formatted = raw.results.map((r) => ({
        name: r.name,
        symbol: r.symbol,
        isSI: r.isSI,
        rawValue: r.value,
        text: formatValue(r.value, sig, dec),
      }));
      return {
        type,
        source: raw.source,
        sourceSymbol: raw.sourceSymbol,
        sourceRawValue: safeNumber(value),
        results: formatted,
      };
    },
    setSettings: (s = {}) => {
      if (s.sigfigs !== undefined) state.sigfigs = clampInt(s.sigfigs, 1, 15);
      if (s.decimals !== undefined) state.decimals = (s.decimals === null ? null : clampInt(s.decimals, 0, 20));
      if (s.type !== undefined && Types.includes(s.type)) state.type = s.type;
      if (s.pinnedFrom !== undefined) state.pinnedFrom = s.pinnedFrom;
      if (s.pinnedTo !== undefined) state.pinnedTo = s.pinnedTo;
      // update UI if present
      if (root) renderAll();
      return getState();
    },
    focusUnits: (fromUnit, toUnit) => {
      state.pinnedFrom = fromUnit || null;
      state.pinnedTo = toUnit || null;
      if (root) renderAll();
      return getState();
    },
    getState: () => getState(),
    destroy: () => {
      if (root) {
        root.remove();
        root = null;
      }
    },
  };

  // --- DOM building (if enabled)
  let root = null;

  if (config.dom) {
    // create root only if not already present
    if (!document.getElementById(config.containerId)) {
      root = document.createElement('div');
      root.id = config.containerId;
      document.body.appendChild(root);
    } else {
      root = document.getElementById(config.containerId);
    }

    // inject CSS (classes only, no inline styles)
    const styleId = config.containerId + '-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.innerHTML = `
        /* basic layout */
        #${config.containerId} { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; padding:16px; max-width:980px; margin:10px auto; box-sizing:border-box; }
        #${config.containerId} .vc-row { display:flex; gap:12px; align-items:center; margin-bottom:8px; flex-wrap:wrap; }
        #${config.containerId} .vc-col { flex:1; min-width:140px; }
        #${config.containerId} .vc-label { font-weight:600; margin-right:8px; display:inline-block; min-width:120px; }
        #${config.containerId} .vc-select, #${config.containerId} .vc-input, #${config.containerId} .vc-search { padding:8px 10px; border:1px solid #ccc; border-radius:6px; width:100%; box-sizing:border-box; }
        #${config.containerId} .vc-controls { display:contents; gap:8px; align-items:center; }
        #${config.containerId} .vc-units { margin-top:12px; display:flex; flex-direction:column; gap:8px; }
        #${config.containerId} .vc-unit-row { display:flex; gap:8px; align-items:center; }
        #${config.containerId} .vc-unit-row .vc-unit-name { width:200px; font-weight:500; }
        #${config.containerId} .vc-unit-row .vc-unit-symbol { color:#555; margin-left:6px; font-size:0.95em; }
        #${config.containerId} .vc-unit-row .vc-input { flex:1; }
        #${config.containerId} .vc-copy { padding:6px 10px; border-radius:6px; border:1px solid #ddd; background:#f7f7f7; cursor:pointer; }
        #${config.containerId} .vc-si { background: linear-gradient(90deg, rgba(255,255,0,0.15), rgba(255,255,0,0.05)); border-left:4px solid #ffdd57; padding-left:8px; }
        #${config.containerId} .vc-hint { font-size:0.9em; color:#666; margin-top:8px; }
        #${config.containerId} .vc-search-suggestions { position:relative; }
        #${config.containerId} .vc-suggestions-list { position:absolute; background:white; border:1px solid #ddd; width:100%; max-height:180px; overflow:auto; z-index:40; box-shadow:0 6px 16px rgba(0,0,0,0.08); }
        #${config.containerId} .vc-suggestion { padding:6px 10px; cursor:pointer; }
        #${config.containerId} .vc-suggestion:hover { background:#f0f0f0; }
        @media (max-width:640px){ #${config.containerId} .vc-unit-row .vc-unit-name { width:120px; } }
      `;
      document.head.appendChild(style);
    }

    // build DOM structure
    root.innerHTML = ''; // reset

    const header = document.createElement('div');
    header.className = 'vc-row';
    header.innerHTML = `
      <div class="vc-col" style="min-width:240px">
        <div class="vc-label">Type</div>
        <select class="vc-select" id="${config.containerId}-type"></select>
      </div>
      <div class="vc-col vc-search-suggestions" style="max-width:360px;">
        <div class="vc-label">Search units</div>
        <input placeholder="Search unit name or symbol (e.g. km, mile, lb)" class="vc-search" id="${config.containerId}-search"/>
        <div class="vc-suggestions-list" id="${config.containerId}-suggestions" style="display:none"></div>
      </div>
      <div class="vc-col vc-controls" style="min-width:220px">
        <div>
          <div class="vc-label">Sig figs</div>
          <input id="${config.containerId}-sig" class="vc-input" type="number" min="1" max="15" />
        </div>
        <div>
          <div class="vc-label">Decimals</div>
          <input id="${config.containerId}-dec" class="vc-input" type="number" min="0" max="20" />
        </div>
      </div>
    `;
    root.appendChild(header);

    const pinRow = document.createElement('div');
    pinRow.className = 'vc-row';
    pinRow.innerHTML = `
      <div class="vc-col">
        <div class="vc-label">Pinned From</div>
        <select class="vc-select" id="${config.containerId}-pin-from"><option value="">(none)</option></select>
      </div>
      <div class="vc-col">
        <div class="vc-label">Pinned To</div>
        <select class="vc-select" id="${config.containerId}-pin-to"><option value="">(none)</option></select>
      </div>
      <div class="vc-col">
        <div class="vc-label">Share URL</div>
        <div style="display:flex; gap:8px;">
          <button id="${config.containerId}-share" class="vc-copy">Update URL</button>
          <button id="${config.containerId}-copy-url" class="vc-copy">Copy URL</button>
        </div>
      </div>
    `;
    root.appendChild(pinRow);

    const unitsContainer = document.createElement('div');
    unitsContainer.className = 'vc-units';
    unitsContainer.id = `${config.containerId}-units`;
    root.appendChild(unitsContainer);

    const hint = document.createElement('div');
    hint.className = 'vc-hint';
    hint.innerText = 'Type a value into any field to convert to all other units. Click copy to copy field value.';
    root.appendChild(hint);

    // populate type dropdown
    const typeSelect = qs(`#${config.containerId}-type`, root);
    Types.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.text = t;
      typeSelect.appendChild(opt);
    });

    // populate global fields
    const sigInput = qs(`#${config.containerId}-sig`, root);
    const decInput = qs(`#${config.containerId}-dec`, root);

    sigInput.value = state.sigfigs;
    decInput.value = state.decimals === null ? '' : state.decimals;

    // suggestions behavior
    const searchInput = qs(`#${config.containerId}-search`, root);
    const suggBox = qs(`#${config.containerId}-suggestions`, root);

    function buildSuggestions(query) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) {
        suggBox.style.display = 'none';
        suggBox.innerHTML = '';
        return;
      }
      const matches = Units.filter((u) => u.name.toLowerCase().includes(q) || (u.symbol && u.symbol.toLowerCase().includes(q)));
      if (matches.length === 0) {
        suggBox.style.display = 'none';
        suggBox.innerHTML = '';
        return;
      }
      suggBox.innerHTML = '';
      matches.slice(0, 50).forEach((m) => {
        const div = document.createElement('div');
        div.className = 'vc-suggestion';
        div.innerText = `${m.name} ${m.symbol ? '(' + m.symbol + ')' : ''} — ${m.type}`;
        div.onclick = () => {
          // auto-select type and focus unit
          state.type = m.type;
          state.pinnedFrom = m.name;
          state.pinnedTo = null;
          renderAll();
          // place the suggestions box away
          suggBox.style.display = 'none';
        };
        suggBox.appendChild(div);
      });
      suggBox.style.display = '';
    }

    searchInput.addEventListener('input', (e) => buildSuggestions(e.target.value));
    document.addEventListener('click', (ev) => {
      if (!root.contains(ev.target)) {
        suggBox.style.display = 'none';
      }
    });

    // share url update & copy
    const shareBtn = qs(`#${config.containerId}-share`, root);
    const copyUrlBtn = qs(`#${config.containerId}-copy-url`, root);
    shareBtn.onclick = () => {
      updateUrl();
    };
    copyUrlBtn.onclick = async () => {
      updateUrl();
      await copyToClipboard(window.location.href);
      alert('URL copied to clipboard');
    };

    // units rendering and interaction
    function renderAll() {
      // set selects to current state
      typeSelect.value = state.type;
      sigInput.value = state.sigfigs;
      decInput.value = state.decimals === null ? '' : state.decimals;

      // populate pinned selects
      const pinFrom = qs(`#${config.containerId}-pin-from`, root);
      const pinTo = qs(`#${config.containerId}-pin-to`, root);
      pinFrom.innerHTML = '<option value="">(none)</option>';
      pinTo.innerHTML = '<option value="">(none)</option>';
      (UnitsByType[state.type] || []).forEach((u) => {
        const o1 = document.createElement('option');
        o1.value = u.name;
        o1.text = `${u.name} ${u.symbol ? '(' + u.symbol + ')' : ''}`;
        pinFrom.appendChild(o1);
        const o2 = document.createElement('option');
        o2.value = u.name;
        o2.text = `${u.name} ${u.symbol ? '(' + u.symbol + ')' : ''}`;
        pinTo.appendChild(o2);
      });
      pinFrom.value = state.pinnedFrom || '';
      pinTo.value = state.pinnedTo || '';

      // render unit inputs (pinned first)
      const unitsList = (UnitsByType[state.type] || []).slice();
      // move pinned to top ordering
      const order = [];
      if (state.pinnedFrom) {
        const idx = unitsList.findIndex((u) => u.name === state.pinnedFrom);
        if (idx >= 0) order.push(unitsList.splice(idx, 1)[0]);
      }
      if (state.pinnedTo && state.pinnedTo !== state.pinnedFrom) {
        const idx2 = unitsList.findIndex((u) => u.name === state.pinnedTo);
        if (idx2 >= 0) order.push(unitsList.splice(idx2, 1)[0]);
      }
      const finalList = order.concat(unitsList);

      const unitsContainerEl = qs(`#${config.containerId}-units`, root);
      unitsContainerEl.innerHTML = '';
      finalList.forEach((u) => {
        const row = document.createElement('div');
        row.className = 'vc-unit-row' + (u.isSI ? ' vc-si' : '');
        row.dataset.unitName = u.name;
        // unit label + symbol, input, copy
        const nameSpan = document.createElement('div');
        nameSpan.className = 'vc-unit-name';
        nameSpan.innerHTML = `${u.name}<span class="vc-unit-symbol">${u.symbol ? u.symbol : ''}</span>`;
        const inp = document.createElement('input');
        inp.className = 'vc-input';
        inp.type = 'text';
        inp.placeholder = u.symbol ? `${u.symbol}` : u.name;
        inp.dataset.unit = u.name;
        inp.value = ''; // clear
        // Add event handlers for conversion
        inp.addEventListener('input', (e) => {
          const val = e.target.value.trim();
          if (val === '') {
            // clear last state
            state.lastInputUnit = null;
            state.lastInputValue = null;
            // empty other fields
            qsa(`#${config.containerId}-units .vc-input`, root).forEach((i) => {
              if (i !== inp) i.value = '';
            });
            updateUrl();
            return;
          }
          const num = Number(val.replace(/,/g, ''));
          if (isNaN(num)) return;
          // perform conversion programmatically then populate
          state.lastInputUnit = u.name;
          state.lastInputValue = num;
          const conv = api.convert(state.type, u.name, num, { sigfigs: state.sigfigs, decimals: state.decimals });
          if (conv) {
            // update fields
            conv.results.forEach((r) => {
              const el = qs(`#${config.containerId}-units .vc-input[data-unit="${r.name}"]`, root);
              if (el && el !== inp) el.value = r.text;
            });
          }
          updateUrl();
        });

        // allow pressing Enter to copy
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            copyToClipboard(inp.value);
          }
        });

        const copyBtn = document.createElement('button');
        copyBtn.className = 'vc-copy';
        copyBtn.innerText = 'Copy';
        copyBtn.onclick = async () => {
          const ok = await copyToClipboard(inp.value);
          if (ok) {
            copyBtn.innerText = 'Copied';
            setTimeout(() => (copyBtn.innerText = 'Copy'), 900);
          } else {
            alert('Copy failed');
          }
        };

        row.appendChild(nameSpan);
        row.appendChild(inp);
        row.appendChild(copyBtn);
        unitsContainerEl.appendChild(row);
      });
    }

    // type select change
    typeSelect.addEventListener('change', (e) => {
      state.type = e.target.value;
      // clear last input state
      state.lastInputUnit = null;
      state.lastInputValue = null;
      renderAll();
      updateUrl();
    });

    // pinned selects change
    qs(`#${config.containerId}-pin-from`, root).addEventListener('change', (e) => {
      state.pinnedFrom = e.target.value || null;
      renderAll();
      updateUrl();
    });
    qs(`#${config.containerId}-pin-to`, root).addEventListener('change', (e) => {
      state.pinnedTo = e.target.value || null;
      renderAll();
      updateUrl();
    });

    // sig/dec change
    sigInput.addEventListener('change', (e) => {
      const v = clampInt(e.target.value, 1, 15);
      state.sigfigs = v;
      renderAll();
      updateUrl();
    });
    decInput.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === '') {
        state.decimals = null;
      } else {
        state.decimals = clampInt(val, 0, 20);
      }
      renderAll();
      updateUrl();
    });

    // initialize from URL params if any
    function readUrlParams() {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('type');
      if (t && Types.includes(t)) state.type = t;
      const s = params.get('sig');
      if (s !== null) state.sigfigs = clampInt(parseInt(s), 1, 15);
      const d = params.get('dec');
      if (d !== null) state.decimals = d === '' ? null : clampInt(parseInt(d), 0, 20);
      const pf = params.get('from');
      if (pf) state.pinnedFrom = pf;
      const pt = params.get('to');
      if (pt) state.pinnedTo = pt;
      const last = params.get('last');
      const lastUnit = params.get('unit');
      if (last && lastUnit) {
        const num = safeNumber(last);
        if (num !== null && (UnitsByType[state.type] || []).some(u => u.name === lastUnit)) {
          // populate UI with this
          state.lastInputUnit = lastUnit;
          state.lastInputValue = num;
        }
      }
    }

    readUrlParams();
    renderAll();

    // If URL included a last value, populate and convert
    if (state.lastInputUnit && state.lastInputValue !== null) {
      // set field and trigger conversion
      const el = qs(`#${config.containerId}-units .vc-input[data-unit="${state.lastInputUnit}"]`, root);
      if (el) {
        el.value = state.lastInputValue;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    function updateUrl() {
      const params = new URLSearchParams();
      params.set('type', state.type);
      params.set('sig', String(state.sigfigs));
      params.set('dec', state.decimals === null ? '' : String(state.decimals));
      if (state.pinnedFrom) params.set('from', state.pinnedFrom);
      if (state.pinnedTo) params.set('to', state.pinnedTo);
      if (state.lastInputUnit && state.lastInputValue !== null) {
        params.set('unit', state.lastInputUnit);
        params.set('last', String(state.lastInputValue));
      }
      const newUrl = window.location.pathname + '?' + params.toString();
      window.history.replaceState({}, '', newUrl);
    }
  } // end if config.dom true

  // helper for API getState
  function getState() {
    return {
      type: state.type,
      sigfigs: state.sigfigs,
      decimals: state.decimals,
      pinnedFrom: state.pinnedFrom,
      pinnedTo: state.pinnedTo,
      lastInputUnit: state.lastInputUnit,
      lastInputValue: state.lastInputValue,
    };
  }

  // If DOM is disabled, return API only (no UI built)
  return api;
}
UnitConverter();
const api = UnitConverter({ dom: false });
api.getUnits('Lengths'); // -> array of units
console.log("10m in inch = " + api.convert('Lengths', 'meter', 10).results.filter(x => x.name == "inch")[0].rawValue); // -> { unit: 'Meter', value: 10, conversions: [...] }