import{ Dialog }from"./dialog.js";
import{ Message }from"./message.js";
import{ MarkDown }from"./markdown.js";
import{ embedjson, invitejson }from"./jsontypes.js";
import{ getapiurls, getInstances }from"./login.js";
import{ Guild }from"./guild.js";

class Embed{
	type: string;
	owner: Message;
	json: embedjson;
	constructor(json: embedjson, owner: Message){
		this.type = this.getType(json);
		this.owner = owner;
		this.json = json;
	}
	getType(json: embedjson){
		const instances = getInstances();
		if(
			instances &&
json.type === "link" &&
json.url &&
URL.canParse(json.url)
		){
			const Url = new URL(json.url);
			for(const instance of instances){
				if(instance.url && URL.canParse(instance.url)){
					const IUrl = new URL(instance.url);
					const params = new URLSearchParams(Url.search);
					let host: string;
					if(params.has("instance")){
						const url = params.get("instance") as string;
						if(URL.canParse(url)){
							host = new URL(url).host;
						}else{
							host = Url.host;
						}
					}else{
						host = Url.host;
					}
					if(IUrl.host === host){
						const code =
Url.pathname.split("/")[Url.pathname.split("/").length - 1];
						json.invite = {
							url: instance.url,
							code,
						};
						return"invite";
					}
				}
			}
		}
		return json.type || "rich";
	}
	generateHTML(){
		switch(this.type){
		case"rich":
			return this.generateRich();
		case"image":
			return this.generateImage();
		case"invite":
			return this.generateInvite();
		case"link":
			return this.generateLink();
		case"video":
		case"article":
			return this.generateArticle();
		default:
			console.warn(
				`unsupported embed type ${this.type}, please add support dev :3`,
				this.json
			);
			return document.createElement("div"); //prevent errors by giving blank div
		}
	}
	get message(){
		return this.owner;
	}
	get channel(){
		return this.message.channel;
	}
	get guild(){
		return this.channel.guild;
	}
	get localuser(){
		return this.guild.localuser;
	}
	generateRich(){
		const div = document.createElement("div");
		if(this.json.color){
			div.style.backgroundColor = "#" + this.json.color.toString(16);
		}
		div.classList.add("embed-color");

		const embed = document.createElement("div");
		embed.classList.add("embed");
		div.append(embed);

		if(this.json.author){
			const authorline = document.createElement("div");
			if(this.json.author.icon_url){
				const img = document.createElement("img");
				img.classList.add("embedimg");
				img.src = this.json.author.icon_url;
				authorline.append(img);
			}
			const a = document.createElement("a");
			a.textContent = this.json.author.name as string;
			if(this.json.author.url){
				MarkDown.safeLink(a, this.json.author.url);
			}
			a.classList.add("username");
			authorline.append(a);
			embed.append(authorline);
		}
		if(this.json.title){
			const title = document.createElement("a");
			title.append(new MarkDown(this.json.title, this.channel).makeHTML());
			if(this.json.url){
				MarkDown.safeLink(title, this.json.url);
			}
			title.classList.add("embedtitle");
			embed.append(title);
		}
		if(this.json.description){
			const p = document.createElement("p");
			p.append(new MarkDown(this.json.description, this.channel).makeHTML());
			embed.append(p);
		}

		embed.append(document.createElement("br"));
		if(this.json.fields){
			for(const thing of this.json.fields){
				const div = document.createElement("div");
				const b = document.createElement("b");
				b.textContent = thing.name;
				div.append(b);
				const p = document.createElement("p");
				p.append(new MarkDown(thing.value, this.channel).makeHTML());
				p.classList.add("embedp");
				div.append(p);

				if(thing.inline){
					div.classList.add("inline");
				}
				embed.append(div);
			}
		}
		if(this.json.footer || this.json.timestamp){
			const footer = document.createElement("div");
			if(this.json?.footer?.icon_url){
				const img = document.createElement("img");
				img.src = this.json.footer.icon_url;
				img.classList.add("embedicon");
				footer.append(img);
			}
			if(this.json?.footer?.text){
				const span = document.createElement("span");
				span.textContent = this.json.footer.text;
				footer.append(span);
			}
			if(this.json?.footer && this.json?.timestamp){
				const span = document.createElement("span");
				span.textContent = " • ";
				footer.append(span);
			}
			if(this.json?.timestamp){
				const span = document.createElement("span");
				span.textContent = new Date(this.json.timestamp).toLocaleString();
				footer.append(span);
			}
			embed.append(footer);
		}
		return div;
	}
	generateImage(){
		const img = document.createElement("img");
		img.classList.add("messageimg");
		img.onclick = function(){
			const full = new Dialog(["img", img.src, ["fit"]]);
			full.show();
		};
		img.src = this.json.thumbnail.proxy_url;
		if(this.json.thumbnail.width){
			let scale = 1;
			const max = 96 * 3;
			scale = Math.max(scale, this.json.thumbnail.width / max);
			scale = Math.max(scale, this.json.thumbnail.height / max);
			this.json.thumbnail.width /= scale;
			this.json.thumbnail.height /= scale;
		}
		img.style.width = this.json.thumbnail.width + "px";
		img.style.height = this.json.thumbnail.height + "px";
		console.log(this.json, "Image fix");
		return img;
	}
	generateLink(){
		const table = document.createElement("table");
		table.classList.add("embed", "linkembed");
		const trtop = document.createElement("tr");
		table.append(trtop);
		if(this.json.url && this.json.title){
			const td = document.createElement("td");
			const a = document.createElement("a");
			MarkDown.safeLink(a, this.json.url);
			a.textContent = this.json.title;
			td.append(a);
			trtop.append(td);
		}
		{
			const td = document.createElement("td");
			const img = document.createElement("img");
			if(this.json.thumbnail){
				img.classList.add("embedimg");
				img.onclick = function(){
					const full = new Dialog(["img", img.src, ["fit"]]);
					full.show();
				};
				img.src = this.json.thumbnail.proxy_url;
				td.append(img);
			}
			trtop.append(td);
		}
		const bottomtr = document.createElement("tr");
		const td = document.createElement("td");
		if(this.json.description){
			const span = document.createElement("span");
			span.textContent = this.json.description;
			td.append(span);
		}
		bottomtr.append(td);
		table.append(bottomtr);
		return table;
	}
	invcache: [invitejson, { cdn: string; api: string }] | undefined;
	generateInvite(){
		if(this.invcache && (!this.json.invite || !this.localuser)){
			return this.generateLink();
		}
		const div = document.createElement("div");
		div.classList.add("embed", "inviteEmbed", "flexttb");
		const json1 = this.json.invite;
		(async ()=>{
			let json: invitejson;
			let info: { cdn: string; api: string };
			if(!this.invcache){
				if(!json1){
					div.classList.remove("embed", "inviteEmbed", "flexttb")
					div.append(this.generateLink());
					return;
				}
				const tempinfo = await getapiurls(json1.url);

				if(!tempinfo){
					div.classList.remove("embed", "inviteEmbed", "flexttb")
					div.append(this.generateLink());
					return;
				}
				info = tempinfo;
				const res = await fetch(info.api + "/invites/" + json1.code);
				if(!res.ok){
					div.classList.remove("embed", "inviteEmbed", "flexttb")
					div.append(this.generateLink());
					return;
				}
				json = (await res.json()) as invitejson;
				this.invcache = [json, info];
			}else{
				[json, info] = this.invcache;
			}
			if(!json){
				div.append(this.generateLink());
				div.classList.remove("embed", "inviteEmbed", "flexttb")
				return;
			}
			if(json.guild.banner){
				const banner = document.createElement("img");
				banner.src = this.localuser.info.cdn + "/icons/" + json.guild.id + "/" + json.guild.banner + ".png?size=256";
				banner.classList.add("banner");
				div.append(banner);
			}
			const guild: invitejson["guild"] & { info?: { cdn: string } } =
json.guild;
			guild.info = info;
			const icon = Guild.generateGuildIcon(
guild as invitejson["guild"] & { info: { cdn: string } }
			);
			const iconrow = document.createElement("div");
			iconrow.classList.add("flexltr");
			iconrow.append(icon);
			{
				const guildinfo = document.createElement("div");
				guildinfo.classList.add("flexttb", "invguildinfo");
				const name = document.createElement("b");
				name.textContent = guild.name;
				guildinfo.append(name);

				const members = document.createElement("span");
				members.innerText =
"#" + json.channel.name + " • Members: " + guild.member_count;
				guildinfo.append(members);
				members.classList.add("subtext");
				iconrow.append(guildinfo);
			}

			div.append(iconrow);
			const h2 = document.createElement("h2");
			h2.textContent = `You've been invited by ${json.inviter.username}`;
			div.append(h2);
			const button = document.createElement("button");
			button.textContent = "Accept";
			if(this.localuser.info.api.startsWith(info.api) && this.localuser.guildids.has(guild.id)){
				button.textContent = "Already joined";
				button.disabled = true;
			}
			button.classList.add("acceptinvbutton");
			div.append(button);
			button.onclick = _=>{
				if(this.localuser.info.api.startsWith(info.api)){
					fetch(this.localuser.info.api + "/invites/" + json.code, {
						method: "POST",
						headers: this.localuser.headers,
					})
						.then(r=>r.json())
						.then(_=>{
							if(_.message){
								alert(_.message);
							}
						});
				}else{
					if(this.json.invite){
						const params = new URLSearchParams("");
						params.set("instance", this.json.invite.url);
						const encoded = params.toString();
						const url = `${location.origin}/invite/${this.json.invite.code}?${encoded}`;
						window.open(url, "_blank");
					}
				}
			};
		})();
		return div;
	}
	generateArticle(){
		const colordiv = document.createElement("div");
		colordiv.style.backgroundColor = "#000000";
		colordiv.classList.add("embed-color");

		const div = document.createElement("div");
		div.classList.add("embed");
		if(this.json.provider){
			const provider = document.createElement("p");
			provider.classList.add("provider");
			provider.textContent = this.json.provider.name;
			div.append(provider);
		}
		const a = document.createElement("a");
		if(this.json.url && this.json.url){
			MarkDown.safeLink(a, this.json.url);
			a.textContent = this.json.url;
			div.append(a);
		}
		if(this.json.description){
			const description = document.createElement("p");
			description.textContent = this.json.description;
			div.append(description);
		}
		if(this.json.thumbnail){
			const img = document.createElement("img");
			if(this.json.thumbnail.width && this.json.thumbnail.width){
				let scale = 1;
				const inch = 96;
				scale = Math.max(scale, this.json.thumbnail.width / inch / 4);
				scale = Math.max(scale, this.json.thumbnail.height / inch / 3);
				this.json.thumbnail.width /= scale;
				this.json.thumbnail.height /= scale;
				img.style.width = this.json.thumbnail.width + "px";
				img.style.height = this.json.thumbnail.height + "px";
			}
			img.classList.add("bigembedimg");
			if(this.json.video){
				img.onclick = async ()=>{
					if(this.json.video){
						img.remove();
						const iframe = document.createElement("iframe");
						iframe.src = this.json.video.url + "?autoplay=1";
						if(this.json.thumbnail.width && this.json.thumbnail.width){
							iframe.style.width = this.json.thumbnail.width + "px";
							iframe.style.height = this.json.thumbnail.height + "px";
						}
						div.append(iframe);
					}
				};
			}else{
				img.onclick = async ()=>{
					const full = new Dialog(["img", img.src, ["fit"]]);
					full.show();
				};
			}
			img.src = this.json.thumbnail.proxy_url || this.json.thumbnail.url;
			div.append(img);
		}
		colordiv.append(div);
		return colordiv;
	}
}
export{ Embed };
