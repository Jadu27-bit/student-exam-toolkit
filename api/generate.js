import { YoutubeTranscript } from 'youtube-transcript';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ytUrl, rawNotes } = req.body;
  let contentToSummarize = rawNotes || '';

  try {
    // 1. If a YouTube URL is provided, fetch its transcript
    if (ytUrl) {
      try {
        const transcriptItems = await YoutubeTranscript.fetchTranscript(ytUrl);
        const fullTranscript = transcriptItems.map(item => item.text).join(' ');
        contentToSummarize = fullTranscript.slice(0, 14000); // Keep within free limit
      } catch (ytError) {
        return res.status(400).json({
          error: 'Could not fetch captions from this YouTube video (captions might be disabled). Try copying the transcript or pasting notes into Option B!'
        });
      }
    }

    if (!contentToSummarize || contentToSummarize.length < 10) {
      return res.status(400).json({ error: 'Please provide valid text or a YouTube video with captions.' });
    }

    // 2. Send content to Groq API (Uses your hidden Vercel Environment Variable)
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server API Key not configured yet.' });
    }

    const prompt = `You are an expert academic tutor. Based on the following lecture/text, create:
1. CLEAN REVISION NOTES: Structured, easy-to-memorize bullet points covering all key concepts, definitions, and formulas.
2. 5 MULTIPLE-CHOICE QUESTIONS (MCQs): 5 exam-style questions with 4 options (A, B, C, D) and provide the Answer Key with brief explanations at the very bottom.

Content:
${contentToSummarize}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
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
