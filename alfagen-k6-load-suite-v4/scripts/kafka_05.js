import { Writer } from "k6/x/kafka";
import { kafkaClientConfig } from "../lib/kafka.js";

var topic = __ENV.KAFKA_TOPIC_05 || "alfagen.loadtest.topic05";
var writer = new Writer(kafkaClientConfig(topic));

export function kafka05() {
    var messageId = "alfagen_load_test_05-" + __VU + "-" + __ITER;
    var message = {
        messageId: messageId,
        eventType: "ALFAGEN_LOAD_TEST_05",
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
