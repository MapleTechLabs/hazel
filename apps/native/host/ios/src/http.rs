//! Requests the runtime sends as the native app (`x-auth-mode: native`: sign-in and the session),
//! made with the system's URL loading instead of the page's `fetch`. The API admits a native
//! request only without `Origin`, `Sec-Fetch-Mode` and cookies, which WebKit adds to every fetch
//! from a page and its workers and no script can remove; `NSURLSession` adds none of them.
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2_foundation::{
    NSData, NSError, NSHTTPURLResponse, NSMutableURLRequest, NSString, NSURL, NSURLResponse,
    NSURLSession, NSURLSessionConfiguration,
};
use serde_json::{Map, Value, json};

use crate::bridge::{log, reply};

/// Sends request `text` (`{ id, url, method, headers, body }` from `src/ios.ts`); the response,
/// or why there is none, goes back to the worker as `{ id, status, headers, body }` or
/// `{ id, error }`.
pub fn send(text: &str) {
    let Ok(request) = serde_json::from_str::<Value>(text) else {
        return log("[host] fetch: not a request");
    };
    let Some(id) = request["id"].as_u64() else {
        return log("[host] fetch: a request without an id");
    };
    let answer = move |message: Value| {
        DispatchQueue::main().exec_async(move || reply(&message));
    };
    let Some(url) = request["url"]
        .as_str()
        .and_then(|url| NSURL::URLWithString(&NSString::from_str(url)))
    else {
        return answer(json!({ "id": id, "error": "not a URL" }));
    };

    let outgoing = NSMutableURLRequest::requestWithURL(&url);
    outgoing.setHTTPMethod(&NSString::from_str(
        request["method"].as_str().unwrap_or("GET"),
    ));
    outgoing.setHTTPShouldHandleCookies(false);
    if let Some(headers) = request["headers"].as_object() {
        for (name, value) in headers {
            if let Some(value) = value.as_str() {
                outgoing.setValue_forHTTPHeaderField(
                    Some(&NSString::from_str(value)),
                    &NSString::from_str(name),
                );
            }
        }
    }
    if let Some(body) = request["body"].as_str() {
        outgoing.setHTTPBody(Some(&NSData::with_bytes(body.as_bytes())));
    }

    // Ephemeral and cookieless: nothing the request did not carry itself.
    let configuration = NSURLSessionConfiguration::ephemeralSessionConfiguration();
    configuration.setHTTPShouldSetCookies(false);
    configuration.setHTTPCookieStorage(None);
    let session: Retained<NSURLSession> = NSURLSession::sessionWithConfiguration(&configuration);

    let handler = block2::RcBlock::new(
        move |data: *mut NSData, response: *mut NSURLResponse, error: *mut NSError| {
            // SAFETY: the session passes valid objects or null, alive for the call.
            let (data, response, error) =
                unsafe { (data.as_ref(), response.as_ref(), error.as_ref()) };
            let http = response.and_then(|r| r.downcast_ref::<NSHTTPURLResponse>());
            answer(match (error, http) {
                (Some(error), _) => {
                    json!({ "id": id, "error": error.localizedDescription().to_string() })
                }
                (None, None) => json!({ "id": id, "error": "not an HTTP response" }),
                (None, Some(http)) => {
                    let fields = http.allHeaderFields();
                    let mut headers = Map::new();
                    for key in fields.allKeys() {
                        let value = fields.objectForKey(&key);
                        if let (Some(name), Some(value)) = (
                            key.downcast_ref::<NSString>(),
                            value.as_deref().and_then(|v| v.downcast_ref::<NSString>()),
                        ) {
                            headers.insert(name.to_string(), Value::String(value.to_string()));
                        }
                    }
                    let body = data.map(|d| String::from_utf8_lossy(&d.to_vec()).into_owned());
                    json!({
                        "id": id,
                        "status": http.statusCode(),
                        "headers": headers,
                        "body": body.unwrap_or_default(),
                    })
                }
            });
        },
    );
    // SAFETY: the session copies the handler, which owns everything it captures.
    let task = unsafe { session.dataTaskWithRequest_completionHandler(&outgoing, &handler) };
    task.resume();
    // The session lets its one task finish, then lets go of its delegate queue.
    session.finishTasksAndInvalidate();
}
