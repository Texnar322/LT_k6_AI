import { sendHttp } from "../lib/http.js";

export function http03() {
    sendHttp("HTTP_03", "POST", "HTTP_URL_03", "http://localhost:8080/mock/http-03", "HTTP_PAYLOAD_03", '{"eventType":"load-test-03","source":"k6"}');
}
