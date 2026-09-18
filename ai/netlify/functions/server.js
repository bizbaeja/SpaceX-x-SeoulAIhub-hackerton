const serverless = require("serverless-http");
const handleRequest = require("../../server.js");

const baseHandler = serverless(handleRequest);

function withApiPath(event) {
  const next = { ...event };
  let p = next.path || next.rawPath || "/";
  p = p.replace(/^\/\.netlify\/functions\/server\/?/, "/");
  if (!p.startsWith("/api")) {
    p = "/api" + (p.startsWith("/") ? p : `/${p}`);
  }
  if (p === "/api") p = "/api/";
  next.path = p;
  next.rawPath = p;
  return next;
}

exports.handler = async (event, context) => {
  return baseHandler(withApiPath(event), context);
};
