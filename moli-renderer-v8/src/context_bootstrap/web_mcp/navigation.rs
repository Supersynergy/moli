//! Carry only an invocation ID across a native navigation. V8 callbacks remain
//! in the source Document; the destination reports JSON-LD after parsing.
use super::devtools;
use super::state::FormInvocationState;
use crate::document_runtime::DomHandle;
use crate::native_bridge::{JsContextHost, WindowDocumentOwner};
use moli_page_types::{RendererWebMcpEvent, RendererWebMcpResult};

use crate::frame_owner_model::FrameDocumentNavigationLoadBinding;

pub(crate) fn form_invocation(host: &JsContextHost, form: DomHandle) -> Option<u64> {
    host.native_bridge()
        .web_mcp
        .pending
        .iter()
        .find_map(|(id, pending)| {
            (!pending.canceled
                && pending.form.as_ref().is_some_and(|active| {
                    active.handle == form
                        && matches!(
                            active.state,
                            FormInvocationState::Ready
                                | FormInvocationState::Submitting
                                | FormInvocationState::Navigating
                        )
                }))
            .then_some(*id)
        })
}

fn mark_navigating(host: &mut JsContextHost, id: u64) {
    host.native_bridge_mut()
        .web_mcp
        .pending
        .get_mut(&id)
        .expect("active form invocation")
        .form
        .as_mut()
        .expect("form invocation")
        .state = FormInvocationState::Navigating;
}

fn navigation_invocation(host: &JsContextHost, form: DomHandle) -> Option<u64> {
    form_invocation(host, form).filter(|id| {
        host.native_bridge().web_mcp.pending[id]
            .frame_tree
            .is_none()
    })
}

pub(crate) fn bind_root_navigation(host: &mut JsContextHost, form: DomHandle) {
    if let Some(id) = navigation_invocation(host, form)
        && host.bind_pending_web_mcp_navigation(id)
    {
        mark_navigating(host, id);
    }
}

pub(crate) fn bind_child_navigation(host: &mut JsContextHost, form: DomHandle, child: DomHandle) {
    let Some(id) = navigation_invocation(host, form) else {
        return;
    };
    let Some(binding) = host.current_child_navigation_load(child) else {
        return;
    };
    host.native_bridge_mut()
        .web_mcp
        .child_navigations
        .insert(child, (binding, id));
    mark_navigating(host, id);
}

pub(crate) fn cancel_child_navigation(host: &mut JsContextHost, child: DomHandle) {
    if let Some((_, id)) = host
        .native_bridge_mut()
        .web_mcp
        .child_navigations
        .remove(&child)
    {
        fail_navigation(host, id);
    }
}

pub(crate) fn commit_child_navigation(
    host: &mut JsContextHost,
    child: DomHandle,
    binding: Option<FrameDocumentNavigationLoadBinding>,
    owner: WindowDocumentOwner,
) {
    if let Some((expected, id)) = host
        .native_bridge_mut()
        .web_mcp
        .child_navigations
        .remove(&child)
    {
        if binding == Some(expected) {
            receive_navigation(host, owner, id);
        } else {
            fail_navigation(host, id);
        }
    }
}

pub(crate) fn receive_navigation(host: &mut JsContextHost, owner: WindowDocumentOwner, id: u64) {
    host.native_bridge_mut()
        .web_mcp
        .navigation_results
        .insert(owner, id);
}

pub(crate) fn failure_event(id: u64) -> RendererWebMcpEvent {
    RendererWebMcpEvent::ToolResponded {
        invocation_id: id,
        result: RendererWebMcpResult::navigation_failed(),
    }
}

pub(crate) fn fail_navigation(host: &JsContextHost, id: u64) {
    devtools::emit(host, failure_event(id));
}

pub(crate) fn complete_navigation(
    host: &mut JsContextHost,
    document: DomHandle,
    owner: WindowDocumentOwner,
) {
    let Some(id) = host
        .native_bridge_mut()
        .web_mcp
        .navigation_results
        .remove(&owner)
    else {
        return;
    };
    devtools::emit(
        host,
        RendererWebMcpEvent::ToolResponded {
            invocation_id: id,
            result: RendererWebMcpResult::Completed(moli_webmcp::navigation_result(
                host.dom_host(),
                document,
            )),
        },
    );
}
