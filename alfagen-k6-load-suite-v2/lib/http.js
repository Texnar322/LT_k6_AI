import http from "k6/http";
import { check } from "k6";

export function sendHttp(scriptName, method, urlEnv, defaultUrl, payloadEnv, defaultPayload) {
    var url = __ENV[urlEnv] || defaultUrl;
    var body = payloadEnv ? (__ENV[payloadEnv] || defaultPayload || null) : null;
    var params = {
        timeout: __ENV.HTTP_TIMEOUT || "90s",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Load-Test-Run": __ENV.TEST_RUN_ID || "local"
        },
        tags: {
            script: scriptName,
            test_type: "http"
        }
    };

    var response = http.request(method, url, body, params);
    check(response, {
        [scriptName + " status is 2xx"]: function (r) {
            return r.status >= 200 && r.status < 300;
        }
    });

    return response;
}
