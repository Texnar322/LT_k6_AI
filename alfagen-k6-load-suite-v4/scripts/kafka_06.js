import { Writer } from "k6/x/kafka";
import { kafkaClientConfig } from "../lib/kafka.js";

var topic = __ENV.KAFKA_TOPIC_06 || "alfagen.loadtest.topic06";
var writer = new Writer(kafkaClientConfig(topic));

export function kafka06() {
    var messageId = "alfagen_load_test_06-" + __VU + "-" + __ITER;
    var message = {
        messageId: messageId,
        eventType: "ALFAGEN_LOAD_TEST_06",
        source: "k6",
        createdAt: new Date().toISOString(),
        testRun: __ENV.TEST_RUN_ID || "local",
        vu: __VU,
        iteration: __ITER,
        topic: topic
    };

    writer.produce({
        messages: [{
            key: messageId,
            value: JSON.stringify(message)
        }]
    });
}
