import { sendHttp } from "../lib/http.js";

export function http01() {
    sendHttp("HTTP_01", "GET", "HTTP_URL_01", "http://localhost:8080/mock/http-01", null, null);
}
