use super::*;
use moli_fetch::{FetchCancelHandle, NetworkObservationJournal, StreamingRawResponse};
use tokio::sync::{mpsc, oneshot};

fn navigation(token: &DocumentNavigationToken, id: &str) -> NavigationDispatchState {
    let mut navigation = pending_fetch_auth_navigation(id, Some("SID-A")).navigation;
    navigation.loader_id.clone_from(&token.loader_id);
    navigation.frame_id.clone_from(&token.target_id);
    navigation
}

fn request(token: &DocumentNavigationToken, id: &str) -> PendingFetchNavigation {
    PendingFetchNavigation {
        fetch_request_id: id.to_owned(),
        interception_session_id: Some("SID-A".to_owned()),
        document_navigation_token: Some(token.clone()),
        navigation: navigation(token, id),
        request_cookie_report: None,
        intercept_response: false,
        response_stage_url_match_policy: ResponseStageUrlMatchPolicy::AlreadyMatched,
        auth_required_blocked_intercepts: Vec::new(),
    }
}

struct TestStream {
    body: DocumentBodySource,
    cancellation: FetchCancelHandle,
    chunks: mpsc::UnboundedSender<Vec<u8>>,
    completion: oneshot::Sender<anyhow::Result<()>>,
}

fn stream_body() -> TestStream {
    let (chunks, chunks_rx) = mpsc::unbounded_channel();
    let (completion, completion_rx) = oneshot::channel();
    let cancellation = FetchCancelHandle::new();
    let response = StreamingRawResponse::new_with_head(
        PendingFetchAuthNavigation::test_auth_response(test_url("body"))
            .response()
            .head(),
        chunks_rx,
        cancellation.clone(),
        completion_rx,
    );
    TestStream {
        body: DocumentBodySource::StreamingRaw {
            requested_url: test_url("body"),
            request_method: "GET".to_owned(),
            request_headers: Default::default(),
            response,
            network_observation_journal: NetworkObservationJournal::default(),
            body_progress_source: Default::default(),
        },
        cancellation,
        chunks,
        completion,
    }
}

#[test]
fn supersession_retires_all_document_pause_kinds_but_keeps_current_and_subresources() {
    for open_body in [false, true] {
        let mut runtime = TargetRuntimeSlot::default();
        let mut fetch = TargetFetchState::default();
        let request_token = runtime.start_document_navigation("TID".into(), "LID-request".into());
        fetch.register_pending_fetch_navigation_request(request(&request_token, "request"));
        let auth_token = runtime.start_document_navigation("TID".into(), "LID-auth".into());
        let mut auth = pending_fetch_auth_navigation("auth", Some("SID-other"));
        auth.document_navigation_token = Some(auth_token.clone());
        fetch.register_pending_fetch_auth_navigation("auth".into(), auth);
        let response_token = runtime.start_document_navigation("TID".into(), "LID-response".into());
        let stream = stream_body();
        fetch.register_pending_fetch_response_navigation(
            "response".into(),
            Some(response_token.clone()),
            navigation(&response_token, "response"),
            stream.body,
        );
        if open_body {
            fetch
                .open_pending_fetch_response_body_stream(&mut runtime, "response", "stream".into())
                .unwrap();
        }
        let current = runtime.start_document_navigation("TID".into(), "LID-current".into());
        fetch.register_pending_fetch_navigation_request(request(&current, "current"));
        fetch.register_pending_subresource_fetch_request(
            "xhr".into(),
            pending_subresource_fetch(1, Some("SID-A")),
        );

        let retired = fetch.take_superseded_document_navigations(&current);
        let tokens = retired
            .into_iter()
            .map(|(token, _)| token.unwrap())
            .collect::<HashSet<_>>();
        assert_eq!(
            tokens,
            HashSet::from([request_token, auth_token, response_token])
        );
        assert_eq!(
            fetch.pending_fetch_request_ids,
            HashSet::from(["current".into(), "xhr".into()])
        );
        assert!(fetch.pending_fetch_response_transfers.is_empty());
        assert!(
            stream.cancellation.is_cancelled(),
            "retirement must cancel the transport as well as drop routing metadata"
        );
        assert!(fetch.pending_fetch_navigations.contains_key("current"));
        assert!(fetch.pending_subresource_fetches.contains_key("xhr"));
        assert!(
            fetch
                .take_superseded_document_navigations(&current)
                .is_empty(),
            "retirement is once-only"
        );
    }
}

#[tokio::test]
async fn late_body_read_success_and_failure_cannot_restore_superseded_interception() {
    for succeeds in [false, true] {
        let mut runtime = TargetRuntimeSlot::default();
        let mut fetch = TargetFetchState::default();
        let old = runtime.start_document_navigation("TID".into(), "LID-old".into());
        let stream = stream_body();
        runtime
            .page_slot_mut()
            .add_document_navigation_cancellation(&old, stream.cancellation.clone());
        fetch.register_pending_fetch_response_navigation(
            "response".into(),
            Some(old.clone()),
            navigation(&old, "response"),
            stream.body,
        );
        fetch
            .open_pending_fetch_response_body_stream(&mut runtime, "response", "stream".into())
            .unwrap();
        let PendingFetchResponseBodyStreamReadStart::Pending(read) =
            fetch.start_pending_fetch_response_body_stream_read("stream", None, None)
        else {
            panic!("body read should start");
        };
        let current = runtime.start_document_navigation("TID".into(), "LID-current".into());
        assert!(stream.cancellation.is_cancelled());
        assert!(
            fetch
                .take_superseded_document_navigations(&current)
                .is_empty(),
            "the IO task owns A's terminal reply while it holds the body"
        );
        runtime
            .finish_renderer_document_navigation(&current)
            .unwrap();
        assert!(!runtime.renderer_document_navigation_is_suspended());
        if succeeds {
            stream.chunks.send(b"body".to_vec()).unwrap();
        }
        drop(stream.chunks);
        stream
            .completion
            .send(if succeeds {
                Ok(())
            } else {
                Err(moli_fetch::FetchCancelled.into())
            })
            .unwrap();
        let completed = read.wait().await;
        assert!(matches!(
            fetch.finish_pending_fetch_response_body_stream_read(&mut runtime, completed),
            PendingFetchResponseBodyStreamRead::SupersededNavigation(_)
        ));
        assert!(fetch.pending_fetch_request_ids.is_empty());
        assert!(fetch.pending_fetch_response_transfers.is_empty());
        assert!(!runtime.renderer_document_navigation_is_suspended());
    }
}
