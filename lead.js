/**
 * Small deterministic guardrail around the model's interpretation.  It makes
 * obvious buying signals act immediately even if an LLM response is malformed
 * or slow to classify them correctly.
 */
function normalizeClassification(value) {
  const result = String(value || '').trim().toUpperCase();
  return ['HOT', 'WARM', 'COLD'].includes(result) ? result : 'WARM';
}

function deriveLeadSignal(text) {
  const value = String(text || '').toLowerCase();
  const hot = [
    /\b(how much|price|pricing|cost|quote|quotation|proposal|estimate|charges?|fees?)\b/,
    /\b(start|begin|go ahead|let'?s do (this|it)|book (it|now|a call)|ready to (buy|start|proceed)|deal|proceed)\b/,
    /\b(when can you|how soon|need it (by|soon|quickly|urgently)|launch (by|in|next))\b/,
    /\b(send (me )?(the )?(details|info|information|link|catalog|portfolio|samples|quote|proposal|rates?|pricing))\b/,
    /\b(whatsapp (pe|par|me|lo|ki|chey|send)|share on whatsapp)\b/,
    /कितना|कीमत|दाम|खर्चा|बजट.*है|कब.*शुरू|शुरू.*कर|डिटेल.*भेज|व्हाट्सएप.*भेज|प्रपोजल|कोटेशन/,
    /ఎంత.*ఖర్చు|ధర|రేట్|ఎప్పుడు.*ప్రారంభ|స్టార్ట్.*చేయ|వివరాలు.*పంప|వాట్సాప్.*పంప|కొటేషన్/
  ];
  const warm = [
    /\b(budget is (low|tight|small|limited|not much)|not much budget|too expensive|costly|pricey|discount|less money|can'?t afford)\b/,
    /\b(need to (think|discuss|check|talk|ask)|will (think|check|discuss))\b/,
    /\b((partner|brother|father|sister|family|team|boss|manager|co-founder) (handles?|manages?|decides?|takes care|looks after)|ask (my )?(partner|brother|father|sister|family|team|boss|manager)|not (the )?(sole )?decision maker)\b/,
    /\b(later|tomorrow|next week|call (me )?(back|later|tomorrow)|busy right now|in a meeting|driving)\b/,
    /बजट.*कम|महंगा|सोचना|बात करके|पूछ.*के|भाई.*फैसला|भाई.*देखता|पार्टनर|कल.*कॉल|बाद में.*बात|मीटिंग/,
    /బడ్జెట్.*తక్కువ|ధర.*ఎక్కువ|ఆలోచించి|మాట్లాడి|అన్నయ్య|తమ్ముడు|పార్టనర్|రేపు.*కాల్|తర్వాత.*మాట్లాడు|బిజీ/
  ];
  const cold = [
    /\b(not interested|just browsing|no need|don'?t need|stop calling|don'?t call|wrong number|not looking)\b/,
    /दिलचस्पी नहीं|जरूरत नहीं|कॉल मत करो|नहीं चाहिए|गलत नंबर/,
    /ఆసక్తి లేదు|అవసరం లేదు|కాల్ చేయకండి|వద్దు|రాంగ్ నంబర్/
  ];

  if (cold.some((pattern) => pattern.test(value))) return 'COLD';
  if (hot.some((pattern) => pattern.test(value))) return 'HOT';
  if (warm.some((pattern) => pattern.test(value))) return 'WARM';
  return null;
}

module.exports = { deriveLeadSignal, normalizeClassification };
