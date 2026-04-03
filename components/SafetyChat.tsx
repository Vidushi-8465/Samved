// components/SafetyChat.tsx
// SMC LiveMonitor Safety FAQ Chatbot
// RAG using TF-IDF vectors + cosine similarity — no API calls
// Web: floating bottom-right corner
// Mobile: floating button + modal sheet

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Modal, Animated, Platform, Dimensions, KeyboardAvoidingView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const { width: SW, height: SH } = Dimensions.get('window');

// ── COLORS ────────────────────────────────────────────────────
const C = {
  navy:    '#1A3C6E',
  orange:  '#FF6B00',
  green:   '#27AE60',
  red:     '#C0392B',
  amber:   '#E67E22',
  teal:    '#1D9E75',
  white:   '#FFFFFF',
  bg:      '#F8FAFC',
  surface: '#F1F5F9',
  border:  '#E2E8F0',
  text:    '#1A202C',
  muted:   '#64748B',
  // Tag backgrounds
  tagSafeBg:   '#E8F8F0',
  tagSafeTx:   '#27500A',
  tagWarnBg:   '#FEF9E7',
  tagWarnTx:   '#854F0B',
  tagDangerBg: '#FCEBEB',
  tagDangerTx: '#791F1F',
  tagInfoBg:   '#E6F1FB',
  tagInfoTx:   '#0C447C',
};

// ── KNOWLEDGE BASE ────────────────────────────────────────────
type TagColor = 'safe' | 'warn' | 'danger' | 'info';

interface KBEntry {
  tags: string[];
  q: string;
  answer: { tag: TagColor; title: string; lines: string[] };
}

const KB: KBEntry[] = [
  {
    tags: ['ch4','methane','gas','threshold','limit','ppm','mq4','explosive'],
    q: 'What are the CH4 methane gas thresholds?',
    answer: {
      tag: 'safe', title: 'CH4 (Methane) Thresholds',
      lines: [
        'Safe: below 1,000 PPM',
        'Warning: 1,000 – 4,999 PPM',
        'Danger: 5,000+ PPM',
        '',
        'Detected by MQ4 sensor. At danger level, evacuate immediately — methane is explosive and displaces oxygen.',
      ],
    },
  },
  {
    tags: ['co','carbon monoxide','mq7','monoxide'],
    q: 'What is the safe CO (Carbon Monoxide) level?',
    answer: {
      tag: 'warn', title: 'CO (Carbon Monoxide) Thresholds',
      lines: [
        'Safe: below 50 PPM',
        'Warning: 50 – 199 PPM',
        'Danger: 200+ PPM',
        '',
        'CO is odourless and colourless — workers cannot detect it without sensors. 200 PPM can cause unconsciousness in 2–3 hours.',
      ],
    },
  },
  {
    tags: ['h2s','hydrogen sulphide','sulfide','rotten egg','smell'],
    q: 'What is the safe H2S level?',
    answer: {
      tag: 'danger', title: 'H2S (Hydrogen Sulphide) Thresholds',
      lines: [
        'Safe: below 10 PPM',
        'Warning: 10 – 49 PPM',
        'Danger: 50+ PPM',
        '',
        'H2S smells like rotten eggs at low levels, but high concentrations paralyse the sense of smell. Evacuate immediately at 50+ PPM.',
      ],
    },
  },
  {
    tags: ['spo2','oxygen','blood oxygen','saturation','lungs','oxygen level'],
    q: 'What is a safe SpO2 blood oxygen level?',
    answer: {
      tag: 'safe', title: 'SpO2 Blood Oxygen Thresholds',
      lines: [
        'Safe: 95% and above',
        'Warning: 90% – 94%',
        'Danger: below 90%',
        '',
        'Measured by MAX30102. Worker must hold finger on sensor for 30–40 seconds. Below 90% is a medical emergency — call 108 immediately.',
      ],
    },
  },
  {
    tags: ['heart rate','hr','bpm','pulse','heartrate','cardiac'],
    q: 'What heart rate is dangerous for a worker?',
    answer: {
      tag: 'warn', title: 'Heart Rate Thresholds',
      lines: [
        'Safe: 60 – 120 BPM',
        'Warning: below 60 or above 120 BPM',
        'Danger: below 50 or above 130 BPM',
        '',
        'High HR in a sewer may indicate heat stress or gas exposure. Very low HR may indicate unconsciousness.',
      ],
    },
  },
  {
    tags: ['fall','fell','fallen','accident','slip','trip','fall detection','mpu6050'],
    q: 'What happens when a fall is detected?',
    answer: {
      tag: 'danger', title: 'Fall Detection Response',
      lines: [
        '1. MPU6050 detects rapid motion change',
        '2. motionAlert = 1 fires on device',
        '3. Red emergency banner on dashboard',
        '4. SMS fired to managers within 3 seconds',
        '5. Alert logged with timestamp',
        '',
        'Dispatch rescue immediately. Never send a lone rescuer — always use a team with rope and SCBA gear.',
      ],
    },
  },
  {
    tags: ['emergency','sos','button','what to do','response','urgent','help'],
    q: 'What should I do in an emergency?',
    answer: {
      tag: 'danger', title: 'Emergency Response Steps',
      lines: [
        'Worker inside sewer:',
        '1. Press the SOS button immediately',
        '2. Stay calm, move toward the entry point',
        '3. Do not run — conserve oxygen',
        '',
        'Manager at surface:',
        '1. Acknowledge alert in the app',
        '2. Call 108 (ambulance)',
        '3. Ventilate sewer with blower',
        '4. Do NOT send untrained rescuers inside',
      ],
    },
  },
  {
    tags: ['pre monitoring','premonitoring','before entry','scan','entry check','safe to enter','level'],
    q: 'How does pre-monitoring work before entry?',
    answer: {
      tag: 'info', title: 'Pre-Monitoring Process',
      lines: [
        'Before any worker enters a sewer:',
        '',
        '1. Device lowered on rope — 3 depth levels',
        '2. CH4 and CO sampled at each level',
        '3. System calculates verdict:',
        '',
        'SAFE — Normal precautions, entry permitted',
        'WARNING — Full PPE required before entry',
        'UNSAFE — Do NOT send worker inside',
        '',
        'Result shown on dashboard + SMS to manager.',
      ],
    },
  },
  {
    tags: ['ppe','protective','gear','equipment','safety gear','helmet','suit','mask'],
    q: 'What PPE should a worker wear?',
    answer: {
      tag: 'info', title: 'Required PPE for Sewer Work',
      lines: [
        'Mandatory always:',
        '• Hard hat and safety helmet',
        '• Full-body protective suit',
        '• Non-slip safety boots',
        '• Safety harness and lifeline rope',
        '• SMC LiveMonitor sensor device',
        '',
        'Additional for WARNING level:',
        '• Respiratory mask (N95 minimum)',
        '• Chemical resistant gloves',
        '',
        'A standby person at the surface is always required.',
      ],
    },
  },
  {
    tags: ['lora','signal','rssi','range','offline','weak signal'],
    q: 'What does LoRa signal strength mean?',
    answer: {
      tag: 'info', title: 'LoRa Signal (RSSI) Levels',
      lines: [
        'Excellent: above -60 dBm',
        'Good: -60 to -80 dBm',
        'Weak: -80 to -100 dBm',
        'Very Weak: below -100 dBm',
        '',
        'If signal is very weak, move the receiver closer to the manhole entry. LoRa works up to 2km in open areas.',
      ],
    },
  },
  {
    tags: ['inactive','not moving','no motion','inactivity','stationary','idle'],
    q: 'What does the worker inactive alert mean?',
    answer: {
      tag: 'warn', title: 'Worker Inactivity Alert',
      lines: [
        'Triggered when no movement is detected for 30+ seconds.',
        '',
        'Possible causes:',
        '• Worker paused to work (false alarm)',
        '• Gas exposure causing disorientation',
        '• Worker is unconscious',
        '',
        'Radio or call the worker immediately. If no response in 60 seconds, initiate rescue protocol.',
      ],
    },
  },
  {
    tags: ['sms','alert','notification','message','phone','twilio','receive'],
    q: 'When will I receive an SMS alert?',
    answer: {
      tag: 'info', title: 'SMS Alert Triggers',
      lines: [
        'Pre-monitoring (all verdicts):',
        '• SAFE — entry permitted',
        '• WARNING — full PPE required',
        '• UNSAFE — do not enter',
        '',
        'Continuous monitoring:',
        '• Fall detected only',
        '',
        'SMS arrives within 3–5 seconds. 5-minute cooldown between alerts.',
      ],
    },
  },
  {
    tags: ['finger','no reading','spo2 not showing','sensor not working','zero reading'],
    q: 'Why is SpO2 or HR not showing a reading?',
    answer: {
      tag: 'warn', title: 'No SpO2 / HR Reading',
      lines: [
        '1. No finger detected (finger = 0)',
        '   Fix: Place finger firmly on MAX30102',
        '',
        '2. Sensor warming up',
        '   Fix: Wait 30–40 seconds after placing finger',
        '',
        '3. Gas sensors warming (gasWarming = true)',
        '   Fix: Wait 60–90 seconds after power-on',
        '',
        'If still 0 after 2 minutes, check device hardware.',
      ],
    },
  },
  {
    tags: ['rescue','retrieval','unconscious','rescue steps','confined space','scba'],
    q: 'How to rescue an unconscious worker from a sewer?',
    answer: {
      tag: 'danger', title: 'Sewer Rescue Protocol',
      lines: [
        'NEVER enter alone to rescue someone.',
        'Over 50% of sewer deaths are would-be rescuers.',
        '',
        '1. Call 108 (ambulance) immediately',
        '2. Ventilate the sewer with blower at opening',
        '3. Rescuer MUST wear SCBA (breathing apparatus)',
        '4. Use retrieval rope — do not carry manually',
        '5. Once out — administer fresh air, check pulse',
        '6. Keep worker flat until medical help arrives',
      ],
    },
  },
  {
    tags: ['zone','north','south','east','west','central','solapur','manhole','location'],
    q: 'What zones does SMC LiveMonitor cover?',
    answer: {
      tag: 'info', title: 'Coverage Zones — Solapur',
      lines: [
        'North Zone — Ward 1, 2, 3, Hotgi Road',
        'South Zone — Ward 4, 5, Akkalkot Road',
        'East Zone  — Ward 6, 7, Hutatma Chowk',
        'West Zone  — Ward 8, 9, Pandharpur Road',
        'Central    — Ward 10, 11, Mangalwar Peth',
      ],
    },
  },
];

// ── RAG ENGINE ────────────────────────────────────────────────
function tokenise(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
}

// Build vocabulary from all KB entries
const VOCAB: Record<string, number> = {};
let vidx = 0;
KB.forEach(doc => {
  const words = tokenise(
    doc.q + ' ' + doc.tags.join(' ') + ' ' + doc.answer.lines.join(' ')
  );
  words.forEach(w => { if (VOCAB[w] === undefined) VOCAB[w] = vidx++; });
});
const VS = vidx;

function vectorise(text: string): Float32Array {
  const v = new Float32Array(VS);
  tokenise(text).forEach(t => { if (VOCAB[t] !== undefined) v[VOCAB[t]]++; });
  return v;
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

// Pre-compute document vectors once
const DOC_VECS = KB.map(doc =>
  vectorise(doc.q + ' ' + doc.tags.join(' ') + ' ' + doc.answer.lines.join(' '))
);

function retrieve(query: string): KBEntry | null {
  const qv = vectorise(query);
  const qtokens = tokenise(query);
  const scores = DOC_VECS.map((dv, i) => {
    let score = cosineSim(qv, dv);
    // Tag overlap boost
    const tagHits = KB[i].tags.filter(t =>
      qtokens.some(qt => t.includes(qt) || qt.includes(t))
    ).length;
    score += tagHits * 0.18;
    return { i, score };
  });
  scores.sort((a, b) => b.score - a.score);
  return scores[0].score > 0.06 ? KB[scores[0].i] : null;
}

// ── TYPES ─────────────────────────────────────────────────────
interface Message {
  id: number;
  role: 'bot' | 'user';
  text?: string;
  entry?: KBEntry;
  notFound?: boolean;
}

const SUGGESTIONS = [
  'Gas thresholds',
  'Emergency steps',
  'Fall detection',
  'Pre-monitoring',
  'Safe SpO2 range',
  'Rescue protocol',
];

const WELCOME: KBEntry = {
  tags: [], q: '',
  answer: {
    tag: 'info',
    title: 'SMC LiveMonitor Safety Assistant',
    lines: [
      'Hi! I can answer questions about:',
      '• Gas thresholds (CH4, CO, H2S)',
      '• Worker vitals (SpO2, heart rate)',
      '• Emergency procedures',
      '• Fall detection and alerts',
      '• Pre-monitoring process',
      '• PPE requirements',
      '',
      'Ask a question or tap a suggestion.',
    ],
  },
};

// ── TAG BADGE ─────────────────────────────────────────────────
function TagBadge({ type }: { type: TagColor }) {
  const map = {
    safe:   { bg: C.tagSafeBg,   color: C.tagSafeTx,   label: 'Safe' },
    warn:   { bg: C.tagWarnBg,   color: C.tagWarnTx,   label: 'Warning' },
    danger: { bg: C.tagDangerBg, color: C.tagDangerTx, label: 'Danger' },
    info:   { bg: C.tagInfoBg,   color: C.tagInfoTx,   label: 'Info' },
  };
  const t = map[type];
  return (
    <View style={[tag.pill, { backgroundColor: t.bg }]}>
      <Text style={[tag.text, { color: t.color }]}>{t.label}</Text>
    </View>
  );
}
const tag = StyleSheet.create({
  pill: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 6 },
  text: { fontSize: 10, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.3 },
});

// ── BOT BUBBLE ────────────────────────────────────────────────
function BotBubble({ entry }: { entry: KBEntry }) {
  return (
    <View style={bubble.botWrap}>
      <TagBadge type={entry.answer.tag} />
      <Text style={bubble.title}>{entry.answer.title}</Text>
      {entry.answer.lines.map((line, i) =>
        line === '' ? (
          <View key={i} style={{ height: 6 }} />
        ) : (
          <Text key={i} style={bubble.line}>{line}</Text>
        )
      )}
    </View>
  );
}

function NotFoundBubble() {
  return (
    <View style={bubble.botWrap}>
      <TagBadge type="info" />
      <Text style={bubble.title}>Not found</Text>
      <Text style={bubble.line}>I don't have that specific answer. Try asking about:</Text>
      <View style={{ height: 4 }} />
      {['Gas thresholds (CH4, CO, H2S)', 'Worker vitals (SpO2, heart rate)',
        'Emergency and rescue steps', 'Fall detection response',
        'Pre-monitoring scan process', 'PPE requirements'].map((t, i) =>
        <Text key={i} style={bubble.line}>• {t}</Text>
      )}
    </View>
  );
}

const bubble = StyleSheet.create({
  botWrap: { backgroundColor: C.surface, borderRadius: 12, borderBottomLeftRadius: 3, padding: 12, maxWidth: '84%', alignSelf: 'flex-start' },
  title:   { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: C.navy, marginBottom: 6 },
  line:    { fontSize: 12, fontFamily: 'Poppins_400Regular', color: C.text, lineHeight: 18 },
});

// ── WEB CHATBOT (injected as floating HTML on web) ────────────
function WebChatbot() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const existing = document.getElementById('sn-chat-root');
    if (existing) return;

    // Build knowledge base as JSON for the web script
    const kbJson = JSON.stringify(KB.map(k => ({
      tags: k.tags, q: k.q,
      tag: k.answer.tag, title: k.answer.title, lines: k.answer.lines,
    })));

    const style = document.createElement('style');
    style.id = 'sn-chat-style';
    style.textContent = `
      #sn-wrap{position:fixed;bottom:24px;right:24px;z-index:99999;font-family:system-ui,sans-serif}
      #sn-btn{width:54px;height:54px;border-radius:50%;background:#1A3C6E;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(26,60,110,.4);transition:transform .18s}
      #sn-btn:hover{transform:scale(1.07)}
      #sn-badge{position:absolute;top:-3px;right:-3px;width:18px;height:18px;border-radius:50%;background:#E24B4A;color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff}
      #sn-box{position:fixed;bottom:90px;right:24px;width:360px;height:500px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.13);transition:opacity .2s,transform .2s}
      #sn-box.hide{opacity:0;pointer-events:none;transform:translateY(14px)}
      #sn-hdr{background:#1A3C6E;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
      .sn-av{width:34px;height:34px;border-radius:50%;background:#FF6B00;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0}
      .sn-hn{font-size:13px;font-weight:600;color:#fff}
      .sn-hs{font-size:11px;color:#9FE1CB;margin-top:1px}
      #sn-x{background:none;border:none;cursor:pointer;color:rgba(255,255,255,.6);font-size:17px;padding:2px 6px;border-radius:4px;line-height:1}
      #sn-x:hover{color:#fff;background:rgba(255,255,255,.12)}
      #sn-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}
      #sn-msgs::-webkit-scrollbar{width:3px}
      #sn-msgs::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:2px}
      .sn-bot{background:#f1f5f9;border-radius:12px 12px 12px 3px;padding:10px 12px;max-width:83%;align-self:flex-start;font-size:12.5px;line-height:1.55;color:#1a202c}
      .sn-user{background:#1A3C6E;color:#fff;border-radius:12px 12px 3px 12px;padding:9px 12px;max-width:83%;align-self:flex-end;font-size:12.5px}
      .sn-ttl{font-size:13px;font-weight:600;color:#1A3C6E;margin-bottom:5px}
      .sn-pill{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-bottom:6px;letter-spacing:.3px}
      .p-safe{background:#E8F8F0;color:#27500A}.p-warn{background:#FEF9E7;color:#854F0B}.p-danger{background:#FCEBEB;color:#791F1F}.p-info{background:#E6F1FB;color:#0C447C}
      .sn-dot{width:6px;height:6px;border-radius:50%;background:#94a3b8;display:inline-block;margin:0 2px;animation:sn-blink 1.2s infinite}
      @keyframes sn-blink{0%,80%,100%{opacity:.3}40%{opacity:1}}
      #sn-sugs{padding:6px 14px 8px;display:flex;flex-wrap:wrap;gap:5px;flex-shrink:0}
      .sn-s{font-size:11px;padding:4px 10px;border:1px solid #e2e8f0;border-radius:20px;background:#f8fafc;color:#475569;cursor:pointer}
      .sn-s:hover{background:#e2e8f0;color:#1a202c}
      #sn-irow{padding:10px 12px 13px;border-top:1px solid #f1f5f9;display:flex;gap:8px;flex-shrink:0}
      #sn-inp{flex:1;padding:8px 13px;font-size:12.5px;border:1px solid #e2e8f0;border-radius:20px;background:#f8fafc;color:#1a202c;outline:none;font-family:inherit}
      #sn-inp:focus{border-color:#1A3C6E;background:#fff}
      #sn-send{width:34px;height:34px;border-radius:50%;background:#FF6B00;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
      #sn-send:hover{background:#e05d00}
      @media(max-width:420px){#sn-box{width:calc(100vw - 16px);right:8px;bottom:76px}#sn-wrap{right:12px;bottom:12px}}
    `;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'sn-chat-root';
    root.innerHTML = `
      <div id="sn-wrap">
        <button id="sn-btn" onclick="snToggle()">
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div id="sn-badge">1</div>
        </button>
      </div>
      <div id="sn-box" class="hide">
        <div id="sn-hdr">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="sn-av">SN</div>
            <div><div class="sn-hn">SMC LiveMonitor Assistant</div><div class="sn-hs">Online · Safety Knowledge Base</div></div>
          </div>
          <button id="sn-x" onclick="snToggle()">✕</button>
        </div>
        <div id="sn-msgs"></div>
        <div id="sn-sugs">
          ${['Gas thresholds','Emergency steps','Fall detection','Pre-monitoring','Safe SpO2 range','Rescue protocol']
            .map(s => `<button class="sn-s" onclick="snSug('${s}')">${s}</button>`).join('')}
        </div>
        <div id="sn-irow">
          <input id="sn-inp" type="text" placeholder="Ask about worker safety..." onkeydown="if(event.key==='Enter')snSend()" autocomplete="off"/>
          <button id="sn-send" onclick="snSend()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const script = document.createElement('script');
    script.textContent = `
    (function(){
      var KB = ${kbJson};
      var VOCAB={}, vidx=0;
      function tok(t){return t.toLowerCase().replace(/[^a-z0-9\\s]/g,'').split(/\\s+/).filter(Boolean)}
      KB.forEach(function(d){tok(d.q+' '+d.tags.join(' ')+' '+d.lines.join(' ')).forEach(function(w){if(VOCAB[w]===undefined)VOCAB[w]=vidx++;})});
      var VS=vidx;
      function vec(text){var v=new Float32Array(VS);tok(text).forEach(function(t){if(VOCAB[t]!==undefined)v[VOCAB[t]]++;});return v}
      var DVECS=KB.map(function(d){return vec(d.q+' '+d.tags.join(' ')+' '+d.lines.join(' '))});
      function cos(a,b){var dot=0,na=0,nb=0;for(var i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return dot/(Math.sqrt(na)*Math.sqrt(nb)+1e-9)}
      function retrieve(q){
        var qv=vec(q),qt=tok(q);
        var scores=DVECS.map(function(dv,i){
          var s=cos(qv,dv);
          var hits=KB[i].tags.filter(function(t){return qt.some(function(x){return t.includes(x)||x.includes(t)})}).length;
          return{i:i,s:s+hits*0.18};
        });
        scores.sort(function(a,b){return b.s-a.s});
        return scores[0].s>0.06?KB[scores[0].i]:null;
      }
      var open=false;
      window.snToggle=function(){
        open=!open;
        document.getElementById('sn-box').classList.toggle('hide',!open);
        document.getElementById('sn-badge').style.display='none';
        if(open){setTimeout(function(){document.getElementById('sn-inp').focus()},220);if(!document.getElementById('sn-msgs').children.length)snWelcome();}
      };
      function tagHtml(type){var m={safe:'p-safe Safe',warn:'p-warn Warning',danger:'p-danger Danger',info:'p-info Info'};var p=m[type].split(' ');return '<span class="sn-pill '+p[0]+'">'+p[1]+'</span>'}
      function entryHtml(e){return tagHtml(e.tag)+'<div class="sn-ttl">'+e.title+'</div>'+e.lines.map(function(l){return l?'<div>'+l+'</div>':'<div style="height:5px"></div>'}).join('')}
      function addBot(html){var d=document.createElement('div');d.className='sn-bot';d.innerHTML=html;var m=document.getElementById('sn-msgs');m.appendChild(d);m.scrollTop=99999}
      function addUser(t){var d=document.createElement('div');d.className='sn-user';d.textContent=t;var m=document.getElementById('sn-msgs');m.appendChild(d);m.scrollTop=99999}
      function showTyping(){var d=document.createElement('div');d.id='sn-typ';d.className='sn-bot';d.innerHTML='<span class="sn-dot" style="animation-delay:0s"></span><span class="sn-dot" style="animation-delay:.2s"></span><span class="sn-dot" style="animation-delay:.4s"></span>';document.getElementById('sn-msgs').appendChild(d);}
      function rmTyping(){var t=document.getElementById('sn-typ');if(t)t.remove()}
      function snWelcome(){addBot(tagHtml('info')+'<div class="sn-ttl">SMC LiveMonitor Safety Assistant</div>Hi! I can answer questions about gas thresholds, worker vitals, emergency procedures, fall detection, pre-monitoring, and PPE requirements.<br><br>Ask a question or tap a suggestion below.')}
      window.snSend=function(){
        var inp=document.getElementById('sn-inp');
        var text=inp.value.trim();if(!text)return;
        inp.value='';addUser(text);
        document.getElementById('sn-sugs').style.display='none';
        showTyping();
        setTimeout(function(){
          rmTyping();
          var r=retrieve(text);
          if(r){addBot(entryHtml(r))}
          else{addBot(tagHtml('info')+"<div class='sn-ttl'>Not found</div>Try asking about gas thresholds, SpO2, heart rate, emergency steps, fall detection, pre-monitoring, rescue protocol, or PPE.")}
        },500+Math.random()*400);
      };
      window.snSug=function(t){document.getElementById('sn-inp').value=t;snSend()};
    })();
    `;
    document.body.appendChild(script);
  }, []);

  return null;
}

// ── NATIVE CHATBOT (React Native Modal) ───────────────────────
function NativeChatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [showSugs, setShowSugs] = useState(true);
  const [badge, setBadge] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const scaleBtn = useRef(new Animated.Value(1)).current;
  let msgId = useRef(0);

  const openChat = () => {
    setBadge(false);
    if (messages.length === 0) {
      setMessages([{ id: msgId.current++, role: 'bot', entry: WELCOME }]);
    }
    setOpen(true);
  };

  const pressIn = () => Animated.spring(scaleBtn, { toValue: 0.92, useNativeDriver: true }).start();
  const pressOut = () => Animated.spring(scaleBtn, { toValue: 1, useNativeDriver: true }).start();

  const sendMsg = useCallback((text: string) => {
    const q = text.trim();
    if (!q) return;
    setInput('');
    setShowSugs(false);
    const userMsg: Message = { id: msgId.current++, role: 'user', text: q };
    setMessages(prev => [...prev, userMsg]);
    setTyping(true);
    setTimeout(() => {
      const result = retrieve(q);
      setTyping(false);
      const botMsg: Message = result
        ? { id: msgId.current++, role: 'bot', entry: result }
        : { id: msgId.current++, role: 'bot', notFound: true };
      setMessages(prev => [...prev, botMsg]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }, 500 + Math.random() * 400);
  }, []);

  return (
    <>
      {/* Floating launcher */}
      <Animated.View style={[ns.launcherWrap, { transform: [{ scale: scaleBtn }] }]}>
        <TouchableOpacity
          style={ns.launcher}
          onPress={openChat}
          onPressIn={pressIn}
          onPressOut={pressOut}
          activeOpacity={1}
        >
          <MaterialCommunityIcons name="chat-question" size={24} color={C.white} />
          {badge && (
            <View style={ns.badge}>
              <Text style={ns.badgeTx}>1</Text>
            </View>
          )}
        </TouchableOpacity>
      </Animated.View>

      {/* Chat Modal */}
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={ns.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={ns.sheet}
          >
            {/* Header */}
            <View style={ns.header}>
              <View style={ns.headerLeft}>
                <View style={ns.avatar}><Text style={ns.avatarTx}>SN</Text></View>
                <View>
                  <Text style={ns.hName}>SurakshaNet Assistant</Text>
                  <Text style={ns.hStatus}>Online · Safety Knowledge Base</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setOpen(false)} style={ns.closeBtn}>
                <MaterialCommunityIcons name="close" size={20} color="rgba(255,255,255,.8)" />
              </TouchableOpacity>
            </View>

            {/* Messages */}
            <ScrollView
              ref={scrollRef}
              style={ns.messages}
              contentContainerStyle={ns.messagesContent}
              showsVerticalScrollIndicator={false}
            >
              {messages.map(msg => (
                <View key={msg.id}>
                  {msg.role === 'user' ? (
                    <View style={ns.userBubble}>
                      <Text style={ns.userTx}>{msg.text}</Text>
                    </View>
                  ) : msg.notFound ? (
                    <NotFoundBubble />
                  ) : msg.entry ? (
                    <BotBubble entry={msg.entry} />
                  ) : null}
                </View>
              ))}
              {typing && (
                <View style={ns.typingWrap}>
                  {[0, 1, 2].map(i => <TypingDot key={i} delay={i * 200} />)}
                </View>
              )}
            </ScrollView>

            {/* Suggestions */}
            {showSugs && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={ns.sugRow}
                contentContainerStyle={{ paddingHorizontal: 12, gap: 6, paddingVertical: 6 }}
              >
                {SUGGESTIONS.map(s => (
                  <TouchableOpacity key={s} style={ns.sugChip} onPress={() => sendMsg(s)}>
                    <Text style={ns.sugTx}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Input */}
            <View style={ns.inputRow}>
              <TextInput
                style={ns.input}
                value={input}
                onChangeText={setInput}
                placeholder="Ask about worker safety..."
                placeholderTextColor={C.muted}
                onSubmitEditing={() => sendMsg(input)}
                returnKeyType="send"
                blurOnSubmit={false}
              />
              <TouchableOpacity style={ns.sendBtn} onPress={() => sendMsg(input)}>
                <MaterialCommunityIcons name="send" size={16} color={C.white} />
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

function TypingDot({ delay }: { delay: number }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 350, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return <Animated.View style={[ns.dot, { opacity: anim }]} />;
}

const ns = StyleSheet.create({
  launcherWrap: { position: 'absolute', bottom: 24, right: 20, zIndex: 999 },
  launcher: { width: 54, height: 54, borderRadius: 27, backgroundColor: C.navy, justifyContent: 'center', alignItems: 'center' },
  badge: { position: 'absolute', top: -3, right: -3, width: 18, height: 18, borderRadius: 9, backgroundColor: '#E24B4A', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: C.white },
  badgeTx: { fontSize: 10, color: C.white, fontFamily: 'Poppins_700Bold' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: C.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: SH * 0.85, overflow: 'hidden' },
  header: { backgroundColor: C.navy, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.orange, justifyContent: 'center', alignItems: 'center' },
  avatarTx: { color: C.white, fontSize: 13, fontFamily: 'Poppins_700Bold' },
  hName: { color: C.white, fontSize: 14, fontFamily: 'Poppins_600SemiBold' },
  hStatus: { color: '#9FE1CB', fontSize: 11, fontFamily: 'Poppins_400Regular' },
  closeBtn: { padding: 6 },
  messages: { flexGrow: 0, maxHeight: SH * 0.52 },
  messagesContent: { padding: 14, gap: 10, paddingBottom: 6 },
  userBubble: { backgroundColor: C.navy, borderRadius: 12, borderBottomRightRadius: 3, padding: 10, maxWidth: '83%', alignSelf: 'flex-end' },
  userTx: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: C.white },
  typingWrap: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 12, borderBottomLeftRadius: 3, padding: 10, gap: 5, alignSelf: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.muted },
  sugRow: { borderTopWidth: 1, borderTopColor: C.border, maxHeight: 46 },
  sugChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg },
  sugTx: { fontSize: 11, fontFamily: 'Poppins_500Medium', color: C.muted },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, paddingBottom: 14, borderTopWidth: 1, borderTopColor: C.border },
  input: { flex: 1, height: 40, paddingHorizontal: 14, fontSize: 13, fontFamily: 'Poppins_400Regular', backgroundColor: C.bg, borderRadius: 20, borderWidth: 1, borderColor: C.border, color: C.text },
  sendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.orange, justifyContent: 'center', alignItems: 'center' },
});

// ── MAIN EXPORT ───────────────────────────────────────────────
export default function SafetyChat() {
  if (Platform.OS === 'web') return <WebChatbot />;
  return <NativeChatbot />;
}