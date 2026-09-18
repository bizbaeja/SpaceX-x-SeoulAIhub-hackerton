const { spawn } = require("child_process");

const child = spawn(process.execPath, ["server.js"], {
  cwd: __dirname,
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
child.stderr.on("data", d => { stderr += d.toString(); });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  try {
    await delay(800);

    const healthRes = await fetch("http://127.0.0.1:4173/api/health");
    const health = await healthRes.json();
    console.log("HEALTH", JSON.stringify(health));

    const note = [
      "마포구 소재 중학교 2학년 학생(만 14세)과 상담함.",
      "최근 2주 동안 결석을 5번 했고 친구들과 연락을 피한다고 함.",
      "집에서는 부모님과 거의 대화하지 않고 가족 갈등이 잦다고 말함.",
      "자해나 죽고 싶은 생각이 있는지는 아직 확인하지 못했음.",
      "외부기관 정보공유 동의는 아직 확인하지 않음."
    ].join("\n");

    const structureRes = await fetch("http://127.0.0.1:4173/api/structure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note })
    });

    const structure = await structureRes.json();
    console.log("STRUCTURE_STATUS", structureRes.status);
    console.log(
      "STRUCTURE",
      JSON.stringify({
        model: structure.model,
        summary: structure.structured?.summary,
        facts: structure.structured?.facts?.length,
        needs: structure.structured?.needs?.map(x => x.area),
        unknowns: structure.structured?.unknowns?.map(x => x.key),
        safety: structure.structured?.safety?.status,
        consent: structure.structured?.consent?.status,
        error: structure.error
      })
    );

    if (!healthRes.ok || !health.ok || !health.keyReadable) process.exitCode = 2;
    if (!structureRes.ok || !structure.structured) process.exitCode = 3;
  } catch (error) {
    console.error("SMOKE_ERROR", error.message);
    if (stderr) console.error("SERVER_STDERR", stderr.trim());
    process.exitCode = 1;
  } finally {
    child.kill();
    await delay(150);
  }
}

main();
