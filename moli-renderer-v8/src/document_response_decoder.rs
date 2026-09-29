use moli_encoding::HtmlDocumentStreamingDecoder;
use moli_encoding_detector::detect_legacy_html_encoding;
use moli_web_mime::{is_json_document_mime, is_text_document_mime, is_xml_document_mime};
use url::Url;

pub(crate) fn new_document_response_decoder(
    headers: &[(String, Vec<u8>)],
    content_type: Option<&str>,
    final_url: &Url,
    inherited_encoding: Option<&str>,
) -> HtmlDocumentStreamingDecoder {
    if let Some(mime) = content_type.filter(|mime| is_text_document_mime(mime)) {
        HtmlDocumentStreamingDecoder::new_text_document(
            headers,
            final_url.as_str(),
            detect_legacy_html_encoding,
            is_json_document_mime(mime),
            inherited_encoding,
        )
    } else if content_type.is_some_and(is_xml_document_mime) {
        // XML declarations still apply; neither parent encoding nor heuristics
        // can replace XML's UTF-8 default.
        HtmlDocumentStreamingDecoder::new_with_fallback(headers, Some("UTF-8"))
    } else if inherited_encoding.is_some() {
        HtmlDocumentStreamingDecoder::new_with_fallback(headers, inherited_encoding)
    } else {
        HtmlDocumentStreamingDecoder::new_with_legacy_encoding_detector(
            headers,
            final_url.as_str(),
            detect_legacy_html_encoding,
        )
    }
}

pub(crate) fn decode_document_response(
    bytes: &[u8],
    headers: &[(String, Vec<u8>)],
    content_type: Option<&str>,
    final_url: &Url,
    inherited_encoding: Option<&str>,
) -> (String, &'static str) {
    let mut decoder =
        new_document_response_decoder(headers, content_type, final_url, inherited_encoding);
    let mut text = decoder.push(bytes).concat();
    if let Some(tail) = decoder.finish() {
        text.push_str(&tail);
    }
    (text, decoder.document_encoding_name())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_and_xml_responses_keep_utf8_defaults_with_a_legacy_parent() {
        for (mime, source) in [
            ("application/json", "{\"text\":\"吴姓\"}"),
            ("Text/JSON", "{\"text\":\"吴姓\"}"),
            ("application/problem+json", "{\"text\":\"吴姓\"}"),
            ("application/atom+xml", "<feed>吴姓</feed>"),
            ("application/rss+xml", "<feed>吴姓</feed>"),
            ("text/example+xml", "<feed>吴姓</feed>"),
        ] {
            let headers = [("Content-Type".to_owned(), mime.as_bytes().to_vec())];
            let (decoded, encoding) = decode_document_response(
                source.as_bytes(),
                &headers,
                Some(mime),
                &Url::parse("https://example.test/document").unwrap(),
                Some("GBK"),
            );
            assert_eq!(decoded, source, "{mime}");
            assert_eq!(encoding, "UTF-8", "{mime}");
        }
    }
}
