# 📑 Research Report: Building the OSM AI Assistant
**Project**: AI Chatbot for Mapping Tasks  
**Date**: April 14, 2026  
**Status**: Ready to move to the real software

---

## 1. How we built it
We started with a simple text-based chatbot and turned it into a professional website dashboard. We wanted to see which way of building the AI is better for the team.

### What we did:
1. **First Version**: A simple chatbot that runs on a computer screen (no website).
2. **Move to Cloud**: We switched from local tools to powerful cloud AI (Gemini and Groq) to make the chatbot smarter.
3. **Double Dashboard**: We built a website that shows two different ways to run the AI side-by-side so we can compare them.
4. **Better Look and Security**: We added a login screen and made the chat messages look clean and easy to read.

---

## 2. Tools we used
To make this work, we used these main tools:
- **Groq & Gemini**: The "Brain" of the AI.
- **Node.js**: The motor that runs the background code.
- **React**: The tool we used to build the website.
- **MongoDB**: The digital storage for all our project data.
- **JWT**: A simple way to make the login secure.

---

## 3. Problems faced and solved

### A. Local AI was too slow
**Problem**: At the start, we tried to run the AI locally on our own computers (Ollama). It was very slow and took a long time to answer even simple questions.  
**Solution**: We moved to cloud-based AI, which answers almost instantly.

### B. AI Power Limits
**Problem**: The first cloud AI (Gemini) stopped working because we used it too much at once during testing.  
**Solution**: We switched to **Groq**. It is much faster and doesn't stop working during the demo.

### C. Building for the Web
**Problem**: Connecting a website to a database through an AI is complicated.  
**Solution**: We built a "Bridge" that helps the website talk to the database safely.

---

## 4. Technical Needs for the Next Phase
To successfully integrate the MCP chatbot into the real OSM system, we have identified the following key requirements:

### 🚀 Integration Path:
1. **Deep Software Understanding**: To connect the AI correctly, we need a full review of how the OSM software handles its internal task logic.
2. **Access to the Real Codebase**: We need a dedicated developer environment (for example, a **new branch on GitHub**) so we can safely test the AI integration without affecting the live software.
3. **Professional Tooling**: As this research scales up, we have moved to advanced tools like **VS Code Copilot (Claude Opus)** to handle the more complex coding and integration logic.
4. **Resilient API Tier**: A dedicated, paid subscription for the AI engine (Groq) to ensure zero-latency responses for the team.

---

> [!NOTE]
> This report shows that the AI assistant is ready. We have the technology working; now we just need the proper access and environments to place it into the real system.
