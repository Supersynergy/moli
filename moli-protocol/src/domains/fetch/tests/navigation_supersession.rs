use super::*;

async fn start_request_pause(
    ctx: &mut TestContext,
    id: u64,
    session_id: &str,
    url: &str,
) -> String {
    ctx.process_async(json!({
        "id": id, "sessionId": session_id, "method": "Page.navigate", "params": {"url": url}
    }))
    .await;
    let pause = ctx
        .sent
        .iter()
        .find(|message| {
            message["method"] == "Fetch.requestPaused"
                && message["sessionId"] == session_id
                && message["params"]["request"]["url"] == url
        })
        .expect("request-stage pause");
    pause["params"]["requestId"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn supersession_only_retires_interceptions_owned_by_the_same_target() {
    let mut ctx = TestContext::new();
    let mut bc = attached_browser_context();
    bc.insert_page_target_host(PageTargetHost::with_url(
        "TID-2".into(),
        Some("SID-2".into()),
        "about:blank".into(),
    ));
    ctx.conn.install_browser_context_fixture_for_test(bc);
    for (id, session) in [(1, "SID-1"), (2, "SID-2")] {
        ctx.process_async(json!({"id": id, "sessionId": session, "method": "Fetch.enable"}))
            .await;
        ctx.expect_result(id, json!({}), Some(session));
    }
    let old = start_request_pause(&mut ctx, 3, "SID-1", "http://example.test/old").await;
    let other = start_request_pause(&mut ctx, 4, "SID-2", "http://example.test/other").await;
    let current = start_request_pause(&mut ctx, 5, "SID-1", "http://example.test/current").await;
    let retired = take_response_by_id(&mut ctx, 3);
    assert_eq!(retired["sessionId"], "SID-1");
    assert_eq!(retired["result"]["errorText"], "net::ERR_ABORTED");
    assert!(
        !ctx.sent
            .iter()
            .any(|message| message["id"] == 4 || message["id"] == 5)
    );
    for (id, method, extra) in [
        (6, "Fetch.continueRequest", json!({})),
        (7, "Fetch.failRequest", json!({"errorReason": "Aborted"})),
        (8, "Fetch.fulfillRequest", json!({"responseCode": 200})),
    ] {
        let mut params = extra;
        params["requestId"] = json!(old);
        ctx.process_async(
            json!({"id": id, "sessionId": "SID-1", "method": method, "params": params}),
        )
        .await;
        let reply = take_response_by_id(&mut ctx, id);
        assert_eq!(reply["error"]["message"], "RequestNotFound");
        assert!(
            !ctx.sent.iter().any(|message| message["id"] == 3),
            "late actions cannot reply to the retired navigation twice"
        );
    }
    for (id, session, request, navigate_id) in [(9, "SID-1", current, 5), (10, "SID-2", other, 4)] {
        ctx.process_async(
            json!({"id": id, "sessionId": session, "method": "Fetch.failRequest",
            "params": {"requestId": request, "errorReason": "Aborted"}}),
        )
        .await;
        assert_eq!(take_response_by_id(&mut ctx, id)["result"], json!({}));
        assert_eq!(
            take_response_by_id(&mut ctx, navigate_id)["error"]["message"],
            "Aborted"
        );
        assert!(
            !ctx.conn
                .renderer_document_navigation_is_suspended_for_session_owner(Some(session))
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn supersession_retires_an_auth_pause_without_client_credentials() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route(
                "/",
                get(|| async {
                    (
                        StatusCode::UNAUTHORIZED,
                        [(WWW_AUTHENTICATE, "Basic realm=\"supersession\"")],
                        "auth required",
                    )
                }),
            ),
        )
        .await
        .unwrap();
    });
    let mut ctx = TestContext::new();
    ctx.conn
        .install_browser_context_fixture_for_test(attached_browser_context());
    ctx.process_async(json!({"id": 1, "sessionId": "SID-1", "method": "Fetch.enable", "params": {"handleAuthRequests": true}})).await;
    let old = start_request_pause(&mut ctx, 2, "SID-1", &format!("http://{addr}/")).await;
    ctx.process_async(json!({"id": 3, "sessionId": "SID-1", "method": "Fetch.continueRequest", "params": {"requestId": old}})).await;
    assert!(
        ctx.sent
            .iter()
            .any(|message| message["method"] == "Fetch.authRequired")
    );
    let current = start_request_pause(&mut ctx, 4, "SID-1", "http://example.test/current").await;
    assert_eq!(
        take_response_by_id(&mut ctx, 2)["result"]["errorText"],
        "net::ERR_ABORTED"
    );
    ctx.process_async(
        json!({"id": 5, "sessionId": "SID-1", "method": "Fetch.continueWithAuth",
        "params": {"requestId": old, "authChallengeResponse": {"response": "CancelAuth"}}}),
    )
    .await;
    assert_eq!(
        take_response_by_id(&mut ctx, 5)["error"]["message"],
        "RequestNotFound"
    );
    ctx.process_async(
        json!({"id": 6, "sessionId": "SID-1", "method": "Fetch.failRequest",
        "params": {"requestId": current, "errorReason": "Aborted"}}),
    )
    .await;
    assert_eq!(
        take_response_by_id(&mut ctx, 4)["error"]["message"],
        "Aborted"
    );
    assert!(
        !ctx.conn
            .renderer_document_navigation_is_suspended_for_session_owner(Some("SID-1"))
    );
    assert!(!ctx.sent.iter().any(|message| message["id"] == 2));
    server.abort();
}
