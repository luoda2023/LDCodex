with open("commands.rs","r",encoding="utf-8") as f:
 content = f.read()
content = content.replace("log::info!", "eprintln!")
with open("commands.rs","w",encoding="utf-8") as f:
 f.write(content)
print("Fixed log::info -> eprintln")
