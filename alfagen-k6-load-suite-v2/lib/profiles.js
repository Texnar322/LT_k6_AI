var HTTP_NAMES = ["http01", "http02", "http03", "http04"];
var KAFKA_NAMES = [
    "kafka01", "kafka02", "kafka03", "kafka04", "kafka05",
    "kafka06", "kafka07", "kafka08", "kafka09", "kafka10"
];

function numberEnv(name, fallback) {
    var raw = __ENV[name];
    var value = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!isFinite(value) || value <= 0) {
        throw new Error(name + " must be a positive number.");
    }
    return value;
}

function stringEnv(name, fallback) {
    return __ENV[name] || fallback;
}

function addRateScenarios(scenarios, names, mode, rate, duration, pre, max) {
    var isHttp = names === HTTP_NAMES;

    for (var i = 0; i < names.length; i++) {
        var name = names[i];

        if (mode === "maximum") {
            var prefix = isHttp ? "MAX_HTTP_" : "MAX_KAFKA_";
            var startRate = numberEnv(prefix + "START_RATE", 1);
            var stepRate = numberEnv(prefix + "STEP_RATE", 5);
            var maxRate = numberEnv(prefix + "MAX_RATE", 25);
            var stepDuration = stringEnv("MAX_STEP_DURATION", "2m");

            if (maxRate <= startRate) {
                throw new Error(prefix + "MAX_RATE must be greater than START_RATE.");
            }

            var stages = [];
            var target = startRate;
            while (target < maxRate) {
                target = Math.min(target + stepRate, maxRate);
                stages.push({ duration: stepDuration, target: target });
            }

            scenarios[name] = {
                executor: "ramping-arrival-rate",
                exec: name,
                startRate: startRate,
                timeUnit: "1s",
                stages: stages,
                preAllocatedVUs: pre,
                maxVUs: max,
                gracefulStop: "30s"
            };
        } else {
            scenarios[name] = {
                executor: "constant-arrival-rate",
                exec: name,
                rate: rate,
                timeUnit: "1s",
                duration: duration,
                preAllocatedVUs: pre,
                maxVUs: max,
                gracefulStop: "30s"
            };
        }
    }
}

function baseThresholds() {
    return {
        http_req_failed: ["rate<0.01"],
        checks: ["rate>0.99"],
        kafka_writer_error_count: ["count==0"]
    };
}

export function maximumOptions() {
    var scenarios = {};
    addRateScenarios(scenarios, HTTP_NAMES, "maximum", 0, "", 
        numberEnv("HTTP_PREALLOCATED_VUS", 20), numberEnv("HTTP_MAX_VUS", 100));
    addRateScenarios(scenarios, KAFKA_NAMES, "maximum", 0, "",
        numberEnv("KAFKA_PREALLOCATED_VUS", 20), numberEnv("KAFKA_MAX_VUS", 100));
    return { scenarios: scenarios, thresholds: baseThresholds() };
}

export function stressOptions() {
    var scenarios = {};
    addRateScenarios(scenarios, HTTP_NAMES, "stress",
        numberEnv("STRESS_HTTP_RATE", 10), stringEnv("STRESS_DURATION", "10m"),
        numberEnv("HTTP_PREALLOCATED_VUS", 20), numberEnv("HTTP_MAX_VUS", 100));
    addRateScenarios(scenarios, KAFKA_NAMES, "stress",
        numberEnv("STRESS_KAFKA_RATE", 10), stringEnv("STRESS_DURATION", "10m"),
        numberEnv("KAFKA_PREALLOCATED_VUS", 20), numberEnv("KAFKA_MAX_VUS", 100));
    return { scenarios: scenarios, thresholds: baseThresholds() };
}

export function reliabilityOptions() {
    var scenarios = {};
    addRateScenarios(scenarios, HTTP_NAMES, "reliability",
        numberEnv("RELIABILITY_HTTP_RATE", 5), stringEnv("RELIABILITY_DURATION", "24h"),
        numberEnv("HTTP_PREALLOCATED_VUS", 20), numberEnv("HTTP_MAX_VUS", 100));
    addRateScenarios(scenarios, KAFKA_NAMES, "reliability",
        numberEnv("RELIABILITY_KAFKA_RATE", 5), stringEnv("RELIABILITY_DURATION", "24h"),
        numberEnv("KAFKA_PREALLOCATED_VUS", 20), numberEnv("KAFKA_MAX_VUS", 100));
    return { scenarios: scenarios, thresholds: baseThresholds() };
}

export function batchOptions() {
    var scenarios = {};
    var iterations = Math.floor(numberEnv("BATCH_MESSAGES_PER_TOPIC", 100000));
    var vus = Math.floor(numberEnv("BATCH_KAFKA_VUS_PER_TOPIC", 10));
    var maxDuration = stringEnv("BATCH_MAX_DURATION", "6h");

    for (var i = 0; i < KAFKA_NAMES.length; i++) {
        var name = KAFKA_NAMES[i];
        scenarios[name] = {
            executor: "shared-iterations",
            exec: name,
            vus: vus,
            iterations: iterations,
            maxDuration: maxDuration,
            gracefulStop: "30s"
        };
    }

    return {
        scenarios: scenarios,
        thresholds: { kafka_writer_error_count: ["count==0"] }
    };
}
