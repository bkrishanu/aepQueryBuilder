# Project Introduction
- I would need to create a Web Tool which would help in connecting to Adobe Experience Platform Query service and would allow me to execute the queries. I would need the code also to be pushed to GIT for hosting it in Vercel. 

- Also help me creating a README.md file on how to use the tool and what changes needs to be made before using the tool

- Need a step by step implementation with UI first and then backend services.

### Techical Components
1. UI Components for the page to be built in React and Tailwind
	a. Install the required dependencies
2. Backend Components for the page to be created in NodeJS
	a. Install the required dependencies
3. All ACCESS_TOKEN generated to be accessed at runtime - not be stored in local cookies or storageSession variables.

### UI Components
1. Install the required dependencies
2. The UI should be well formatted with professional color tones used.
3. Use the font as Segoe UI
4. It should have
	a. Provision to upload a json config file with key value pair which will be used for API calls. To be stored in browser storage unless re-uploaded with new config file
	b. **Organization** - Should be read-only textbox. Value to be picked up from json config file uploaded (IMS_ORG). Should be populated after config file upload
	c. **Tenant** - Should be read-only textbox. Value to be picked up from API call detailed in API section. Should be populated after clicking in **Load Sandboxes** button 
	d. **Load Sandboxes** - Button To load the available Sandboxes in the Org
5. The UI should have a dropdown field called **Sandboxes**, showing the Sandboxes for the Organization
6. It should have a **Connect** button which should be enabled only after selecting any value for Sandboxes. Also an indicator showing it has succesfully connected. Green for success and Red for failure.
7. It should have 3 pannels, 
	a. one to write the query called the **Query Editor** with a execute button.
	b. one to display the **Results** of the query in a formatted professional way. It should also have a **Copy Results** button to copy the result to clipboard in a tab delimited format.
	c. another is to have a **Console Log** which will be show all the query logs with timestamp with a **Clear Logs** button.
8. The Query Editor, Results should be in a tab format in the UI. The Console Log is should be in the below panel.


### Backend Components
1. Install the required dependencies
2. Build a backend procss to populate the available Sandboxes in the Org after clicking the Load Sandboxes button
3. Build a backend procss to connect to Adobe Experience Platform > Query Services after clicking on the Connect button - To be pulled from Get Connection Params API detailed in API Section
	a. Params to connect
		i. *host* - host
		ii. *port* - port
		iii. *dbname* - dbName
		iv. *user* - username
		v. *password* - token
4. Once connected, it should be able to execute the query in the query editor, display the result in the Results tab, write the logs in the console.
5. Build a backend procss to be able to write logs in the console with timestamp
6. Functionalities of buttons
	a. **Load Sandboxes**
		i. Should be able to call the api List All Sandboxes and populate the dropdown field value with the Title attribute.
		ii. Tenant value to be populated from the Get Connection Param API call, host attribute.
			[For example: If host is ibmnaamericaspartnersandbox.platform-query.adobe.io, Tenant would be ibmnaamericaspartnersandbox] 
	b. **Connect** - Should be able to call 2 APIs. 
		i. Retrieve a Sandbox - Based on the sandbox selected
		ii.Get Connection Param - To retrive the connection params for connecting
		iii. Should be able to connect to the AEP database using the params
7. Once config file has been uploaded, build a process to store the value in browser and persist untill new config file has been uploaded. Should be able to populate the Organization field after upload.


### API Details

**OAuth Token Call**

- grant_type - hardcoded to client_credentials
- client_id - API_KEY from json config file
- client_secret - CLIENT_SECRET from json config file
- scope - SCOPES from json config file

- From Response fetch the access_token attribute

~~~
curl --request POST \
  --url https://ims-na1.adobelogin.com/ims/token/v3 \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data grant_type=client_credentials \
  --data client_id=f953de0f39ad4ebd963391b73dc9fd40 \
  --data client_secret=p8e-XNu4toz8DdE8ZcD8-mPq3haZZMcgRMWI \
  --data 'scope=AdobeID, openid, read_organizations, additional_info.projectedProductContext, additional_info.roles, adobeio_api, read_client_secret, manage_client_secrets, campaign_sdk, campaign_config_server_general, deliverability_service_general, session, user_management_sdk'
~~~



**List All Sandboxes**

- ACCESS_TOKEN - to be used from OAuth Token Call API
- API_KEY - API_KEY from json config file
- IMS_ORG - IMS_ORG from json config file
- SANDBOX_NAME - Selected from the Sandbox dropdown

- From Response fetch the title attribute to be displayed in UI
- From Response fetch the name attribute to be passed onto other functions

~~~
curl --request GET \
  --url https://platform.adobe.io/data/foundation/sandbox-management/sandboxes \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{ACCESS_TOKEN}}' \
  --header 'x-api-key: {{API_KEY}}' \
  --header 'x-gw-ims-org-id: {{IMS_ORG}}' \
  --header 'x-sandbox-name: {{SANDBOX_NAME}}'
~~~

**Retrieve a Sandbox**
~~~
curl --request GET \
  --url https://platform.adobe.io/data/foundation/sandbox-management/sandboxes/{{SANDBOX_NAME}} \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{ACCESS_TOKEN}}' \
  --header 'x-api-key: {{API_KEY}}' \
  --header 'x-gw-ims-org-id: {{IMS_ORG}}' \
  --header 'x-sandbox-name: {{SANDBOX_NAME}}'
~~~

- ACCESS_TOKEN - to be used from OAuth Token Call API
- API_KEY - API_KEY from json config file
- IMS_ORG - IMS_ORG from json config file
- SANDBOX_NAME - Selected from the Sandbox dropdown

- From Response fetch the title attribute to be displayed in UI
- From Response fetch the name attribute to be passed onto other functions

**Get Connection Param**
~~~
curl --request GET \
  --url https://platform.adobe.io/data/foundation/query/connection_parameters \
  --header 'Authorization: Bearer {{ACCESS_TOKEN}}' \
  --header 'x-api-key: {{API_KEY}}' \
  --header 'x-gw-ims-org-id: {{IMS_ORG}}' \
  --header 'x-sandbox-name: {{SANDBOX_NAME}}'
~~~

- ACCESS_TOKEN - to be used from OAuth Token Call API
- API_KEY - API_KEY from json config file
- IMS_ORG - IMS_ORG from json config file
- SANDBOX_NAME - Selected from the Sandbox dropdown

- From Response fetch
	i. *host* - host
	ii. *port* - port
	iii. *dbname* - dbName
	iv. *user* - username
	v. *password* - token
	
	
### Github Repository
Below is the GIT Repo


`
https://github.com/bkrishanu/aepQueryBuilder.git
`