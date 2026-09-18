const fs=require("fs");
const {callGoogleModel}=require("./server");
const html=fs.readFileSync("./public/index.html","utf8");
const css=fs.readFileSync("./public/styles.css","utf8");
const prompt=`Act as a senior product designer. Review this Korean hackathon MVP UI and return compact JSON design guidance only. Preserve IDs, copy meaning, flow, and functionality. Style: minimal civic-tech, white canvas, charcoal type, one blue accent, almost no shadows/gradients/pills, strong projector readability, accessible focus, responsive. Keys: direction,tokens,layout,remove,componentRules,projectorRules.

HTML:
${html}

CSS:
${css}`;
callGoogleModel(prompt,{model:"gemini-3.8-flash",temperature:.2,maxOutputTokens:2200,responseMimeType:"application/json",thinkingLevel:"low"})
.then(x=>{console.log("MODEL="+x.model);console.log(x.text)})
.catch(e=>{console.error(e.message);process.exit(1)});
