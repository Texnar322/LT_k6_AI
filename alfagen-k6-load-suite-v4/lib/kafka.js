import {
    SASL_PLAIN,
    SASL_SCRAM_SHA256,
    SASL_SCRAM_SHA512,
    TLS_1_2,
} from "k6/x/kafka";

function readPem(envName) {
    var path = __ENV[envName];
    return path ? open(path) : undefined;
}

function getSecurityProtocol(mechanism) {
    var explicitProtocol = (__ENV.KAFKA_SECURITY_PROTOCOL || "").toUpperCase();
    if (explicitProtocol) {
        return explicitProtocol;
    }

    // Backward compatibility with the previous KAFKA_TLS setting.
    var tlsEnabled = (__ENV.KAFKA_TLS || "false").toLowerCase() === "true";
    if (mechanism === "NONE") {
        return tlsEnabled ? "SSL" : "PLAINTEXT";
    }
    return tlsEnabled ? "SASL_SSL" : "SASL_PLAINTEXT";
}

export function kafkaClientConfig(topic) {
    var brokers = (__ENV.KAFKA_BROKERS || "localhost:9092")
        .split(",")
        .map(function (broker) { return broker.trim(); })
        .filter(function (broker) { return broker.length > 0; });

    if (!brokers.length) {
        throw new Error("KAFKA_BROKERS must contain at least one host:port.");
    }

    var mechanism = (__ENV.KAFKA_SASL_MECHANISM || "NONE").toUpperCase();
    var protocol = getSecurityProtocol(mechanism);

    var mechanisms = {
        "PLAIN": SASL_PLAIN,
        "SCRAM-SHA-256": SASL_SCRAM_SHA256,
        "SCRAM-SHA-512": SASL_SCRAM_SHA512
    };

    var usesSasl = protocol === "SASL_PLAINTEXT" || protocol === "SASL_SSL";
    var usesTls = protocol === "SSL" || protocol === "SASL_SSL";

    if (["PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"].indexOf(protocol) === -1) {
        throw new Error("Unsupported KAFKA_SECURITY_PROTOCOL: " + protocol);
    }

    if (usesSasl && mechanism === "NONE") {
        throw new Error(protocol + " requires KAFKA_SASL_MECHANISM.");
    }
    if (!usesSasl && mechanism !== "NONE") {
        throw new Error(protocol + " cannot be used with SASL mechanism " + mechanism + ".");
    }

    var sasl;
    if (usesSasl) {
        if (!mechanisms[mechanism]) {
            throw new Error("Unsupported KAFKA_SASL_MECHANISM: " + mechanism);
        }

        var username = __ENV.KAFKA_SASL_USERNAME;
        var password = __ENV.KAFKA_SASL_PASSWORD;
        if (!username || !password) {
            throw new Error("KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required.");
        }

        sasl = {
            username: username,
            password: password,
            algorithm: mechanisms[mechanism]
        };
    }

    var tls;
    if (usesTls) {
        var ca = readPem("KAFKA_CA_FILE");
        var cert = readPem("KAFKA_CLIENT_CERT_FILE");
        var key = readPem("KAFKA_CLIENT_KEY_FILE");

        if (!!cert !== !!key) {
            throw new Error("For mTLS set both KAFKA_CLIENT_CERT_FILE and KAFKA_CLIENT_KEY_FILE.");
        }

        tls = {
            enableTls: true,
            minVersion: TLS_1_2,
            insecureSkipTlsVerify: (__ENV.KAFKA_TLS_SKIP_VERIFY || "false").toLowerCase() === "true"
        };

        if (ca) tls.serverCaPem = ca;
        if (cert) tls.clientCertPem = cert;
        if (key) tls.clientKeyPem = key;
    }

    var acks = Number(__ENV.KAFKA_REQUIRED_ACKS || "1");
    var timeoutMs = Number(__ENV.KAFKA_WRITE_TIMEOUT_MS || "10000");

    if ([-1, 0, 1].indexOf(acks) === -1) {
        throw new Error("KAFKA_REQUIRED_ACKS must be -1, 0 or 1.");
    }
    if (!isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error("KAFKA_WRITE_TIMEOUT_MS must be a positive number.");
    }

    return {
        brokers: brokers,
        topic: topic,
        autoCreateTopic: (__ENV.KAFKA_AUTO_CREATE_TOPIC || "false").toLowerCase() === "true",
        requiredAcks: acks,
        writeTimeout: timeoutMs * 1000000,
        maxAttempts: 3,
        sasl: sasl,
        tls: tls
    };
}
