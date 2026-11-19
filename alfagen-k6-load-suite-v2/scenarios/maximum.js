import { maximumOptions } from "../lib/profiles.js";
export const options = maximumOptions();
export {
    http01, http02, http03, http04,
    kafka01, kafka02, kafka03, kafka04, kafka05,
    kafka06, kafka07, kafka08, kafka09, kafka10
} from "../lib/workload.js";
