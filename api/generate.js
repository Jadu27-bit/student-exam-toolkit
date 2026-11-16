import { YoutubeTranscript } from 'youtube-transcript';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ytUrl, rawNotes } = req.body;
  let contentToSummarize = rawNotes || '';
  let isFallbackTopic = false;

  try {
    // 1. If a YouTube URL is provided, try fetching the transcript first
    if (ytUrl) {
      try {
        const transcriptItems = await YoutubeTranscript.fetchTranscript(ytUrl);
        const fullTranscript = transcriptItems.map(item => item.text).join(' ');
        contentToSummarize = fullTranscript.slice(0, 14000);
      } catch (ytError) {
        // 2. OFFICIAL OEMBED FALLBACK: Never blocked by YouTube on cloud servers
        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(ytUrl)}&format=json`;
          const oembedRes = await fetch(oembedUrl);

          if (!oembedRes.ok) throw new Error('Invalid YouTube URL');

          const oembedData = await oembedRes.json();
          const videoTitle = oembedData.title || '';
          const channelName = oembedData.author_name || '';

          if (videoTitle) {
            contentToSummarize = `Lecture Title: ${videoTitle}\nChannel/Educator: ${channelName}`;
            isFallbackTopic = true;
          } else {
            throw new Error('Title not found');
          }
        } catch (fallbackErr) {
          return res.status(400).json({
            error: 'Invalid or private YouTube link. Please check the URL or paste the topic in Option B below!'
          });
        }
      }
    }

    if (!contentToSummarize || contentToSummarize.length < 3) {
      return res.status(400).json({ error: 'Please provide valid text or a YouTube link.' });
    }

    // 3. Send to Groq AI
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server API Key not configured in Vercel.' });
    }

    const prompt = isFallbackTopic
      ? `You are an expert academic tutor. A student shared a YouTube lecture with the following title and educator (captions were disabled on the video). Write a comprehensive, exam-ready study guide covering all core concepts of this exact lecture topic:
1. CLEAN REVISION NOTES: Detailed, easy-to-memorize bullet points covering key definitions, formulas, and explanations.
2. 5 MULTIPLE-CHOICE QUESTIONS (MCQs): 5 exam-style questions with 4 options (A, B, C, D) and provide the Answer Key with brief explanations at the bottom.

Lecture Info:
${contentToSummarize}`
      : `You are an expert academic tutor. Based on the following lecture transcript/text, create:
1. CLEAN REVISION NOTES: Structured, easy-to-memorize bullet points covering all key concepts, definitions, and formulas.
2. 5 MULTIPLE-CHOICE QUESTIONS (MCQs): 5 exam-style questions with 4 options (A, B, C, D) and provide the Answer Key with brief explanations at the bottom.

Content:
${contentToSummarize}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5
      })
    });

    const groqData = await groqRes.json();
    if (!groqRes.ok) {
      throw new Error(groqData.error?.message || 'AI API error');
    }

    const resultText = groqData.choices[0].message.content;
    return res.status(200).json({ result: resultText });

  } catch (error) {
    return res.status(500).json({ error: error.message || 'Something went wrong.' });
  }
}
