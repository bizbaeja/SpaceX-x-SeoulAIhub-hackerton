const fs=require("fs");
const {callGoogleModel}=require("./server");
const html=fs.readFileSync("./public/index.html","utf8");
const prompt=`You are a senior product designer. Return CSS ONLY, no markdown.
Redesign this Korean civic-tech hackathon UI while preserving every existing HTML id/class and functionality.
Visual constraints:
- minimalist public-sector product
- white canvas (#FFFFFF), charcoal (#111827), secondary (#4B5563), border (#E5E7EB), one blue (#1D4ED8)
- no gradients, no decorative glass effects, almost no shadow (max 0 1px 2px rgba(0,0,0,.05))
- max content width 1040px
- 4-step navigation should be horizontal on desktop
- strong projector readability
- cards only for true information groups
- final accepted state is calm and conclusive
- accessible focus states, mobile responsive
- preserve .hidden and .loading behavior
- Korean typography professional and dense but readable
Do not add external assets.

HTML:
${html}`;
callGoogleModel(prompt,{model:"gemini-3.8-flash",temperature:.15,maxOutputTokens:7000,responseMimeType:null,thinkingLevel:"low"})
.then(x=>console.log(x.text.replace(/^\`\`\`css\s*/i,"").replace(/\`\`\`\s*$/,"").trim()))
.catch(e=>{console.error("DESIGN_ERROR="+e.message);process.exit(1)});
