fn dot_char() -> String {
    char::from(46u8).to_string()
}

fn test() {
    let dot = dot_char();
    let names = [
        vec!["Codex", &dot, "app"].concat(),
        vec!["OpenAI Codex", &dot, "app"].concat(),
        vec!["OpenAI", &dot, "Codex", &dot, "app"].concat(),
    ];
    let _ = names;
}