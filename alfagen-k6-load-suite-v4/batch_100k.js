import { batchOptions } from "./lib/profiles.js";

export const options = batchOptions();

export {
    kafka01, kafka02, kafka03, kafka04, kafka05,
    kafka06, kafka07, kafka08, kafka09, kafka10
} from "./lib/workload.js";
