const serverless = require("serverless-http");
// default export = handleRequest(req, res)
const handleRequest = require("../../server.js");

exports.handler = serverless(handleRequest);
