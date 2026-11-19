import { sendHttp } from "../lib/http.js";

export function http02() {
    sendHttp("HTTP_02", "POST", "HTTP_URL_02", "http://localhost:8080/mock/http-02", "HTTP_PAYLOAD_02", '{"operationId":"load-test-02","amount":100,"currency":"RUB"}');
}
