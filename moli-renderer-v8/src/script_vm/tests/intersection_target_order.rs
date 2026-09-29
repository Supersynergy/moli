use super::*;

#[tokio::test(flavor = "current_thread")]
async fn intersection_observer_preserves_target_observation_order() {
    let loader = ResourceRequestClient::new(&moli_fetch::FetchConfig::default()).unwrap();
    let mut vm = new_storage_page_task_executor_test_vm("https://intersection-queues.test/");
    let count: usize = vm
        .eval(include_str!(
            "../../../tests/fixtures/intersection-target-order.js"
        ))
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(count, 3);
    for index in 0..count {
        let name = vm
            .eval(&format!("__intersectionQueues.start({index})"))
            .unwrap();
        vm.advance_timers_until_deadline_for_test(&loader)
            .await
            .unwrap();
        assert_eq!(
            vm.eval("__intersectionQueues.result").unwrap(),
            vm.eval("__intersectionQueues.expected").unwrap(),
            "{name}"
        );
    }
}
