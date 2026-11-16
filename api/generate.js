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
        // Take a larger slice (up to 25,000 characters) to capture long lectures
        const fullTranscript = transcriptItems.map(item => item.text).join(' ');
        contentToSummarize = fullTranscript.slice(0, 25000);
      } catch (ytError) {
        // 2. OFFICIAL OEMBED FALLBACK
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

    // 3. Send to Groq AI with a Deep, Exhaustive Academic Prompt
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server API Key not configured in Vercel.' });
    }

    const prompt = isFallbackTopic
      ? `You are a distinguished university professor and academic tutor. A student shared a YouTube lecture title and educator because closed captions were unavailable. Write an exhaustive, highly detailed, deep-dive academic study guide on this exact topic to help them ace their exams. Do not give a short summary; write long, thorough, comprehensive notes:
1. **EXHAUSTIVE LECTURE NOTES**: Break down the topic into clear modules/sections. Provide deep explanations, core principles, historical context or formulas (if applicable), step-by-step breakdowns, and real-world examples for each sub-topic. Make it look like a well-structured textbook chapter or comprehensive coaching notes.
2. **5 ADVANCED EXAM MCQs**: Create 5 rigorous, exam-style multiple-choice questions with 4 options (A, B, C, D) and a detailed paragraph explaining the correct answer key at the bottom.

Lecture Info:
${contentToSummarize}`
      : `You are a distinguished university professor and academic tutor. Based on the following comprehensive lecture transcript/text, write an exhaustive, highly detailed, deep-dive academic study guide. Do not give a brief or superficial summary; provide long, thorough, thorough notes that explain every concept deeply:
1. **EXHAUSTIVE REVISION NOTES**: Organize the content into clear modules/headings. Provide deep theoretical explanations, detailed bullet points, core definitions, mechanisms, and step-by-step breakdowns so a student can master the topic entirely from these notes without watching the video again.
2. **5 ADVANCED EXAM MCQs**: Create 5 rigorous, exam-style multiple-choice questions with 4 options (A, B, C, D) and a detailed paragraph explaining the correct answer key at the very bottom.

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
        temperature: 0.4
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
