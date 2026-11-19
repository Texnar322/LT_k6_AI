import { executeEndpoint } from "../lib/http.js";

export function currency() {
    executeEndpoint("currency");
}
