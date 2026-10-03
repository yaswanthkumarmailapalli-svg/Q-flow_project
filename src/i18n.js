/* =========================================================
   Q-FLOW — LANGUAGES (UI strings and language switching)
   Plain browser script: top-level declarations are shared globals,
   so the load order matters: safe-html.js, net.js, emissions.js, config.js, ui.js, i18n.js, location.js, geocode.js, routing.js, traffic-live.js, swarm-sim.js, map.js, trips.js.
   ========================================================= */

/* ---------- EXPANDED MULTILINGUAL SUPPORT ---------- */
const QFLOW_STRINGS = {
  en: {
    home: 'Home',
    plan: 'Plan a Trip',
    network: 'Road Status',
    alerts: 'Road Alerts',
    start: 'Start →',
    heroTitle: 'Smarter routes.',
    heroTitle2: 'Calmer traffic.',
    heroBody: 'Q-FLOW finds the best route for you and spreads traffic across roads, so roads do not jam.',
    planBtn: 'Plan my trip',
    exploreBtn: 'See road status',
    locating: 'Finding your location…',
    from: 'Starting point',
    to: 'Destination',
    stops: 'Stops along the way',
    addStop: '+ Add stop',
    arriveMode: 'When do you need to get there?',
    leaveNow: 'Leave now',
    arriveBy: 'Arrive by a set time',
    prefLabel: 'What matters most?',
    findBtn: 'Find best routes',
    recent: 'Recent:'
  },
  hi: {
    home: 'होम',
    plan: 'यात्रा योजना',
    network: 'सड़क की स्थिति',
    alerts: 'सड़क अलर्ट',
    start: 'शुरू करें →',
    heroTitle: 'बेहतर रास्ते।',
    heroTitle2: 'शांत ट्रैफ़िक।',
    heroBody:
      'Q-FLOW आपके लिए सबसे अच्छा रास्ता ढूँढता है और ट्रैफ़िक को अलग-अलग सड़कों पर बाँटता है, ताकि सड़कें जाम न हों।',
    planBtn: 'यात्रा अनुकूलित करें',
    exploreBtn: 'सड़क की स्थिति देखें',
    locating: 'स्थान खोजा जा रहा है…',
    from: 'शुरुआती स्थान',
    to: 'गंतव्य',
    stops: 'बीच के पड़ाव',
    addStop: '+ पड़ाव जोड़ें',
    arriveMode: 'कब पहुँचना है?',
    leaveNow: 'अभी निकलें',
    arriveBy: 'तय समय पर पहुँचें',
    prefLabel: 'प्राथमिकता',
    findBtn: 'रास्ते खोजें',
    recent: 'हालिया:'
  },
  te: {
    home: 'హోమ్',
    plan: 'ట్రిప్ ప్లాన్',
    network: 'రోడ్డు స్థితి',
    alerts: 'రోడ్ అలర్ట్స్',
    start: 'ప్రారంభించండి →',
    heroTitle: 'మెరుగైన మార్గాలు.',
    heroTitle2: 'ప్రశాంతమైన ట్రాఫిక్.',
    heroBody:
      'Q-FLOW మీకు ఉత్తమ మార్గాన్ని కనుగొంటుంది మరియు రోడ్లు జామ్ కాకుండా ట్రాఫిక్‌ను వేర్వేరు రోడ్లపై పంచుతుంది.',
    planBtn: 'ప్రయాణాన్ని ఆప్టిమైజ్ చేయండి',
    exploreBtn: 'రోడ్డు స్థితి చూడండి',
    locating: 'స్థానాన్ని కనుగొంటోంది…',
    from: 'ప్రారంభ స్థానం',
    to: 'గమ్యం',
    stops: 'మార్గంలో స్టాప్‌లు',
    addStop: '+ స్టాప్ జోడించండి',
    arriveMode: 'ఎప్పుడు చేరుకోవాలి?',
    leaveNow: 'ఇప్పుడే వెళ్లండి',
    arriveBy: 'నిర్ణీత సమయానికి',
    prefLabel: 'ఆప్టిమైజేషన్ ప్రాధాన్యత',
    findBtn: 'మార్గాలు కనుగొనండి',
    recent: 'ఇటీవలివి:'
  },
  ta: {
    home: 'முகப்பு',
    plan: 'பயணத் திட்டம்',
    network: 'சாலை நிலை',
    alerts: 'சாலை எச்சரிக்கைகள்',
    start: 'தொடங்கு →',
    heroTitle: 'சிறந்த வழிகள்.',
    heroTitle2: 'அமைதியான போக்குவரத்து.',
    heroBody:
      'Q-FLOW உங்களுக்கு சிறந்த வழியைக் கண்டறிந்து, சாலைகள் நெரிசலாகாமல் இருக்க போக்குவரத்தைப் பல சாலைகளில் பகிர்கிறது.',
    planBtn: 'பயணத்தை மேம்படுத்து',
    exploreBtn: 'சாலை நிலையைப் பார்க்கவும்',
    locating: 'இடம் கண்டறியப்படுகிறது…',
    from: 'தொடக்க இடம்',
    to: 'சேருமிடம்',
    stops: 'இடைப்பட்ட நிறுத்தங்கள்',
    addStop: '+ நிறுத்தம் சேர்',
    arriveMode: 'எப்போது அடைய வேண்டும்?',
    leaveNow: 'இப்போதே புறப்படு',
    arriveBy: 'குறிப்பிட்ட நேரத்தில்',
    prefLabel: 'முன்னுரிமை',
    findBtn: 'வழிகளைக் கண்டறி',
    recent: 'சமீபத்திய:'
  },
  mr: {
    home: 'मुख्यपृष्ठ',
    plan: 'प्रवास योजना',
    network: 'रस्त्याची स्थिती',
    alerts: 'रस्ता सूचना',
    start: 'सुरू करा →',
    heroTitle: 'उत्तम मार्ग.',
    heroTitle2: 'शांत वाहतूक.',
    heroBody:
      'Q-FLOW तुमच्यासाठी सर्वोत्तम मार्ग शोधते आणि रस्ते जाम होऊ नयेत म्हणून वाहतूक वेगवेगळ्या रस्त्यांवर विभागते.',
    planBtn: 'प्रवास ऑप्टिमाइझ करा',
    exploreBtn: 'रस्त्याची स्थिती पहा',
    locating: 'स्थान शोधत आहे…',
    from: 'सुरुवातीचे ठिकाण',
    to: 'गंतव्य स्थान',
    stops: 'थांबे',
    addStop: '+ थांबा जोडा',
    arriveMode: 'कधी पोहोचायचे आहे?',
    leaveNow: 'आत्ता निघा',
    arriveBy: 'वेळेवर पोहोचा',
    prefLabel: 'प्राधान्य',
    findBtn: 'मार्ग शोधा',
    recent: 'नुकतेच:'
  }
};

function qflowLang() {
  const saved = localStorage.getItem('qflowLang');
  if (saved && QFLOW_STRINGS[saved]) return saved;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return QFLOW_STRINGS[nav] ? nav : 'en';
}

function qflowApplyLang() {
  const lang = qflowLang();
  const t = QFLOW_STRINGS[lang] || QFLOW_STRINGS.en;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) el.textContent = t[key];
  });
  if (typeof qflowFitNav === 'function') qflowFitNav(); // labels changed width
}

function qflowSetLang(lang) {
  localStorage.setItem('qflowLang', lang);
  qflowApplyLang();
  qflowAudio.playClick();
}

