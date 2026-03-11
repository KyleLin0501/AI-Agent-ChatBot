require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// 目錄初始化
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const HISTORY_DIR = path.join(__dirname, 'chat_history');
[UPLOAD_DIR, HISTORY_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer 配置 (磁碟儲存較穩定)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/api/chat', upload.single('file'), async (req, res) => {
    try {
        const { prompt, history, roleSetting } = req.body;
        const file = req.file;

        const model = genAI.getGenerativeModel({
            model: "models/gemini-2.5-flash",
            systemInstruction: roleSetting || "你是一個專業助手"
        });

        let parsedHistory = [];
        try {
            parsedHistory = JSON.parse(history || '[]');
        } catch (e) { parsedHistory = []; }

        let currentParts = [];
        if (prompt) currentParts.push({ text: prompt });

        if (file) {
            const fileBuffer = fs.readFileSync(file.path);
            if (file.mimetype === 'application/pdf') {
                const pdfData = await pdf(fileBuffer);
                const pdfText = `\n\n[PDF內容摘要]:\n${pdfData.text.substring(0, 10000)}`;
                if (currentParts.length > 0) currentParts[0].text += pdfText;
                else currentParts.push({ text: "分析此文件：" + pdfText });
            } else if (file.mimetype.startsWith('image/')) {
                currentParts.push({
                    inlineData: { data: fileBuffer.toString('base64'), mimeType: file.mimetype }
                });
            }
        }

        const chat = model.startChat({ history: parsedHistory });
        const result = await chat.sendMessage(currentParts);
        const responseText = result.response.text();

        // 結構化儲存 JSON
        const log = {
            timestamp: new Date().toISOString(),
            role: roleSetting,
            input: prompt,
            output: responseText,
            file: file ? file.originalname : null
        };
        fs.writeFileSync(path.join(HISTORY_DIR, `log_${Date.now()}.json`), JSON.stringify(log, null, 2));

        res.json({ text: responseText });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => console.log(`🚀 Server: http://localhost:${port}`));