//! http(s) downloads through the system's URL loading (`NSURLSession`), which iOS and macOS both
//! have, with the system's proxies and TLS; an app on iOS cannot spawn `curl`.
use std::sync::mpsc;
use std::time::Duration;

use objc2_foundation::{
    NSData, NSError, NSHTTPURLResponse, NSString, NSURL, NSURLResponse, NSURLSession,
};

/// The body of a successful (2xx) response to a GET of `url`, or why there is none. Blocks the
/// calling thread, so it runs on a worker thread.
pub fn get(url: &str, timeout: Duration) -> Result<Vec<u8>, String> {
    let target = NSURL::URLWithString(&NSString::from_str(url)).ok_or("not a URL")?;
    let (send, receive) = mpsc::channel();
    let handler = block2::RcBlock::new(
        move |data: *mut NSData, response: *mut NSURLResponse, error: *mut NSError| {
            // SAFETY: the session passes valid objects or null, alive for the call.
            let (data, response, error) =
                unsafe { (data.as_ref(), response.as_ref(), error.as_ref()) };
            let status = response
                .and_then(|r| r.downcast_ref::<NSHTTPURLResponse>())
                .map(|r| r.statusCode());
            let _ = send.send(match (error, status, data) {
                (Some(error), _, _) => Err(error.localizedDescription().to_string()),
                (None, Some(code), _) if !(200..300).contains(&code) => Err(format!("HTTP {code}")),
                (None, _, Some(data)) => Ok(data.to_vec()),
                (None, _, None) => Err("no body".to_string()),
            });
        },
    );
    let task = unsafe {
        NSURLSession::sharedSession().dataTaskWithURL_completionHandler(&target, &handler)
    };
    task.resume();
    receive.recv_timeout(timeout).map_err(|_| {
        task.cancel();
        "timed out".to_string()
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serves one request with `response` on a local port; the URL to ask it at.
    fn serve_once(response: &'static str) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/picture.png", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = stream.read(&mut [0; 1024]);
            stream.write_all(response.as_bytes()).unwrap();
        });
        url
    }

    #[test]
    fn a_download_returns_its_body_and_an_error_status_fails() {
        let ok =
            serve_once("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello");
        assert_eq!(get(&ok, Duration::from_secs(5)), Ok(b"hello".to_vec()));
        let missing =
            serve_once("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert_eq!(
            get(&missing, Duration::from_secs(5)),
            Err("HTTP 404".to_string())
        );
    }

    #[test]
    fn a_failed_download_says_why() {
        assert!(get("not a url at all", Duration::from_secs(1)).is_err());
        // Nothing listens on port 9 (discard) here: the connection is refused.
        assert!(get("http://127.0.0.1:9/picture.png", Duration::from_secs(5)).is_err());
    }
}
