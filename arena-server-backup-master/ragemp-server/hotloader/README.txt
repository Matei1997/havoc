Drag all the folders into server root (place the packages folder into your server/packages, and the hotloader folder in the server root)
in root/hotloader you can do your testing in client.js or server.js or you can create new files in the same directory.
You have to save the file to apply the chagnes.

Auto entity/event remover is activated only when you declare entities with let/var in the main scope (not in if statements or functions)
For events dont use mp.events.add, rather use `let myEvent = new mp.Event('eventName', function)` so hotloader can kill the event listener