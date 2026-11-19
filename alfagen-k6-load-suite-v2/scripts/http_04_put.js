import { sendHttp } from "../lib/http.js";

export function http04() {
    sendHttp("HTTP_04", "PUT", "HTTP_URL_04", "http://localhost:8080/mock/http-04", "HTTP_PAYLOAD_04", '{"id":"load-test-04","status":"updated"}');
}
